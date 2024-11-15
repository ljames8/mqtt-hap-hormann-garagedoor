import {
  HormannGarageDoorOpener,
  CurrentDoorState,
  SerialOptions,
  PacketFilterParams,
  HCPClient,
  SerialHCPClient,
} from "@ljames8/hormann-hcp-client";
import {
  Integration,
  HomeKitIntegration,
  HomeKitIntegrationOptions,
  MQTTIntegration,
  MQTTIntegrationOptions,
} from "./integrations";

export class GarageDoorController extends HormannGarageDoorOpener {
  readonly integrations: Integration[] = [];
  mqttIntegration: MQTTIntegration | undefined;
  homekitIntegration: HomeKitIntegration | undefined;

  constructor(
    name: string = "garage_door",
    hcpClient: HCPClient,
    {
      mqttOptions = {},
      homekitOptions = {},
    }: {
      mqttOptions?: MQTTIntegrationOptions;
      homekitOptions?: HomeKitIntegrationOptions;
    } = {},
  ) {
    super(name, hcpClient);

    if (mqttOptions) {
      this.mqttIntegration = new MQTTIntegration(this, mqttOptions);
      this.integrations.push(this.mqttIntegration);
    }
    if (homekitOptions) {
      this.homekitIntegration = new HomeKitIntegration(this, homekitOptions);
      this.integrations.push(this.homekitIntegration);
    }

    // default print errors
    this.on("error", (err) => {
      this.logger(err);
    });
    // register publish handlers when broadcast status updates
    this.on("update_door", (updatedState: CurrentDoorState) => {
      for (const integration of this.integrations) {
        integration.publishCurrentDoorState(updatedState);
      }
    });
    this.on("update_light", (updatedState: boolean) => {
      for (const integration of this.integrations) {
        integration.publishLightOnState(updatedState);
      }
    });
  }

}

export function createHormannGarageDoorController(
  /** factory function to create a serial enabled Hormann garage door controller */
  name: string | undefined,
  { path, ...rest }: SerialOptions,
  { packetTimeout = 50, filterBreaks = true, filterMaxLength = true }: PacketFilterParams = {},
  {
    mqttOptions = {},
    homekitOptions = {},
  }: {
    mqttOptions?: MQTTIntegrationOptions;
    homekitOptions?: HomeKitIntegrationOptions;
  } = {},
): GarageDoorController {
  return new GarageDoorController(
    name,
    new SerialHCPClient({ path, ...rest }, { packetTimeout, filterBreaks, filterMaxLength }),
    {mqttOptions, homekitOptions},
  );
}
