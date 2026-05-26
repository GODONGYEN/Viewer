import { TVConnectionEvent, TVConnectionOptions, TVConnectorKind, TVConnectionStatus } from "../../shared/tvConnectionTypes";
import { TVDevice } from "../../shared/tvTypes";

export type ConnectorEmit = (event: Omit<TVConnectionEvent, "timestamp">) => void;

export type ConnectorContext = {
  connectionId: string;
  device: TVDevice;
  options: TVConnectionOptions;
  emit: ConnectorEmit;
};

export type ConnectorResult = {
  ok: boolean;
  status: TVConnectionStatus;
  message: string;
  canFallback: boolean;
  details?: Record<string, string | number | boolean | undefined>;
};

export type TVConnector = {
  kind: TVConnectorKind;
  canHandle: (device: TVDevice, options: TVConnectionOptions) => boolean;
  connect: (context: ConnectorContext) => Promise<ConnectorResult>;
  stop?: (connectionId: string) => Promise<ConnectorResult>;
};
