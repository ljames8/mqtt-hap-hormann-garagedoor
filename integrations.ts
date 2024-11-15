import mqtt from "mqtt";
import {
  Accessory,
  Categories,
  Characteristic,
  PublishInfo,
  Service,
  uuid,
} from "hap-nodejs";
import { CurrentDoorState, TargetDoorState } from "@ljames8/hormann-hcp-client";
import type { GarageDoorController } from "./garageDoor";

export abstract class Integration {
  constructor(
    readonly garageController: GarageDoorController,
    protected readonly name: string,
  ) {}

  private notifyOtherIntegrations(fn: () => void): void {
    /** wrapper to call fn on other integrations */
    for (const integration of this.garageController.integrations) {
      if (integration !== this) {
        fn();
      }
    }
  }

  protected notifyTargetDoorStateSet(newState: TargetDoorState): void {
    return this.notifyOtherIntegrations(() =>
      this.publishTargetDoorState?.(newState),
    );
  }

  protected notifyLightOnStateSet(newState: boolean): void {
    return this.notifyOtherIntegrations(() =>
      this.publishLightOnState(newState),
    );
  }

  // get / set handlers for target / current door state and light state
  protected handleCurrentDoorStateGet(): CurrentDoorState {
    return this.garageController.getCurrentState();
  }

  protected handleTargetDoorStateGet(): TargetDoorState {
    return this.garageController.getTargetState();
  }

  protected handleTargetDoorStateSet(newState: TargetDoorState): Promise<void> {
    // set new target state
    return this.garageController.setTargetState(newState).then(() => {
      // notify other integrations for new target door state
      this.notifyTargetDoorStateSet(newState);
    });
  }

  protected handleLightOnStateGet(): boolean {
    return this.garageController.getLightOnState();
  }

  protected handleLightOnStateSet(newState: boolean): Promise<void> {
    // set new lightOn state
    return this.garageController.setLightOnState(newState).then(() => {
      // notify other integrations for new light on state
      this.notifyLightOnStateSet(newState);
    });
  }
  // publish target / current door state and light state updates methods
  abstract publishCurrentDoorState(newState: CurrentDoorState): void;
  abstract publishTargetDoorState?(newState: TargetDoorState): void;
  abstract publishLightOnState(newState: boolean): void;
}

export interface MQTTIntegrationOptions {
  name?: string;
  brokerUrl?: string;
  opts?: mqtt.IClientOptions;
}

export class MQTTIntegration extends Integration {
  private client: mqtt.MqttClient;

  constructor(
    readonly garageController: GarageDoorController,
    {
      name = garageController.name,
      brokerUrl = "mqtt://localhost:1883",
      opts,
    }: MQTTIntegrationOptions = {},
  ) {
    super(garageController, name);
    this.client = mqtt.connect(brokerUrl, opts);
    this.setupMQTTDiscovery();
    this.listenForCommands();
  }

  // Setup MQTT Discovery for Home Assistant
  setupMQTTDiscovery() {
    const garageDoorConfig = {
      name: "Garage Door",
      command_topic: "garage/door/command",
      state_topic: "garage/door/status",
      availability_topic: "garage/door/availability",
      payload_open: "open",
      payload_close: "close",
      state_open: "open",
      state_closed: "closed",
      device_class: "garage",
      unique_id: this.name + "_door",
    };

    const lightConfig = {
      name: "Garage Light",
      command_topic: "garage/light/command",
      state_topic: "garage/light/status",
      availability_topic: "garage/light/availability",
      payload_on: "on",
      payload_off: "off",
      unique_id: this.name + "_light",
      device_class: "light",
    };

    // Publish discovery messages
    this.client.publish(
      "homeassistant/cover/garage_door/config",
      JSON.stringify(garageDoorConfig),
      { retain: true },
    );
    this.client.publish(
      "homeassistant/light/garage_light/config",
      JSON.stringify(lightConfig),
      { retain: true },
    );

    // Set availability
    this.client.publish("garage/door/availability", "online", {
      retain: true,
    });
    this.client.publish("garage/light/availability", "online", {
      retain: true,
    });
  }

  // Listen for MQTT commands
  listenForCommands() {
    this.client.subscribe("garage/door/command");
    this.client.subscribe("garage/light/command");

    this.client.on("message", (topic, message) => {
      const command = message.toString();
      if (topic === "garage/door/command") {
        return this.handleTargetDoorStateSet(MQTTIntegration.doorCommandToTargetDoorState(command));
      }

      if (topic === "garage/light/command") {
        return this.handleLightOnStateSet(MQTTIntegration.lightCommandToBoolean(command));
      }
    });
  }

  static doorCommandToTargetDoorState(command: string): TargetDoorState {
    if (command === "open") {
      return TargetDoorState.OPEN;
    } else if (command === "close") {
      return TargetDoorState.CLOSED;
    } else {
      throw new Error(`unsupported door command ${command}`);
    }
  }

  static lightCommandToBoolean(command: string): boolean {
    return command === "on";
  }

  publishCurrentDoorState(newState: CurrentDoorState): void {
    this.client.publish("garage/door/state", CurrentDoorState[newState]);
  }

  publishTargetDoorState: undefined;

  publishLightOnState(newState: boolean) {
    this.client.publish("garage/light/state", newState === true ? "on" : "off");
  }
}

export interface HomeKitIntegrationOptions {
  name?: string;
  publishInfo?: PublishInfo;
}

export class HomeKitIntegration extends Integration {
  private accessory: Accessory;
  private garageDoorService: Service;
  private lightService: Service;

  constructor(
    garageController: GarageDoorController,
    {
      name = garageController.name,
      publishInfo = {
        username: "11:22:33:44:55:66",
        pincode: "031-45-154",
        port: 51827,
      },
    }: HomeKitIntegrationOptions = {},
  ) {
    super(garageController, name);
    // Initialize the HomeKit accessory
    this.accessory = new Accessory(
      "Garage Door",
      uuid.generate("hap.garage-door"),
    );
    this.accessory.category = Categories.GARAGE_DOOR_OPENER;
    publishInfo.category = Categories.GARAGE_DOOR_OPENER;

    // Setup Garage Door Service
    this.garageDoorService = new Service.GarageDoorOpener("Garage Door");
    this.garageDoorService
      .getCharacteristic(Characteristic.TargetDoorState)
      .on("set", (value, callback) => {
        this.handleTargetDoorStateSet(value as TargetDoorState)
          .then(() => callback(null))
          .catch((error) => callback(error));
      });

    // Report current door state to HomeKit
    this.garageDoorService
      .getCharacteristic(Characteristic.CurrentDoorState)
      .on("get", (callback) => {
        callback(null, this.handleCurrentDoorStateGet());
      });

    // Add Garage Door Service to accessory
    this.accessory.addService(this.garageDoorService);

    // Setup Lightbulb Service
    this.lightService = new Service.Lightbulb("Garage Light");
    this.lightService
      .getCharacteristic(Characteristic.On)
      .on("set", (value, callback) => {
        this.handleLightOnStateSet(value as boolean)
          .then(() => callback(null))
          .catch((error) => callback(error));
      });

    // Report current light state to HomeKit
    this.lightService
      .getCharacteristic(Characteristic.On)
      .on("get", (callback) => {
        callback(null, this.handleLightOnStateGet());
      });

    // Add Lightbulb Service to accessory
    this.accessory.addService(this.lightService);

    // Publish the HomeKit accessory
    this.accessory.publish(publishInfo);
  }

  // Update door state in HomeKit
  publishCurrentDoorState(newState: CurrentDoorState): void {
    this.garageDoorService.updateCharacteristic(
      Characteristic.CurrentDoorState,
      newState,
    );
  }

  // relevant to updatet target door state whenever changed for HomeKit
  publishTargetDoorState(newState: TargetDoorState): void {
    this.garageDoorService.updateCharacteristic(
      Characteristic.TargetDoorState,
      newState,
    );
  }

  // Update light state in HomeKit
  publishLightOnState(newState: boolean): void {
    this.lightService.updateCharacteristic(Characteristic.On, newState);
  }
}
