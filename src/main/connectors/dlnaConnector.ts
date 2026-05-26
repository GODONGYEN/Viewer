import { addMediaFile } from "../mediaServer";
import { ConnectorContext, ConnectorResult, TVConnector } from "./types";

type DlnaServiceInfo = {
  controlUrl: string;
  serviceType: string;
};

const activeDlnaControls = new Map<string, DlnaServiceInfo>();

function extractTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim();
}

export function extractDlnaAvTransportService(descriptionXml: string, location: string): DlnaServiceInfo | null {
  const serviceMatches = descriptionXml.match(/<service\b[\s\S]*?<\/service>/gi) ?? [];

  for (const serviceXml of serviceMatches) {
    const serviceType = extractTag(serviceXml, "serviceType") ?? "";
    if (!serviceType.toLowerCase().includes("avtransport")) continue;

    const controlUrl = extractTag(serviceXml, "controlURL");
    if (!controlUrl) return null;

    return {
      serviceType,
      controlUrl: new URL(controlUrl, location).toString()
    };
  }

  return null;
}

type DlnaAction = "SetAVTransportURI" | "Play" | "Pause" | "Stop" | "Seek";

export function buildDidlLiteMetadata(mediaUrl: string, contentType: string, title = "LAN Screen Viewer Media") {
  const itemClass = contentType.startsWith("audio/") ? "object.item.audioItem.musicTrack" : contentType.startsWith("image/") ? "object.item.imageItem.photo" : "object.item.videoItem";
  return `&lt;DIDL-Lite xmlns:dc=&quot;http://purl.org/dc/elements/1.1/&quot; xmlns:upnp=&quot;urn:schemas-upnp-org:metadata-1-0/upnp/&quot; xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/&quot;&gt;&lt;item id=&quot;0&quot; parentID=&quot;-1&quot; restricted=&quot;1&quot;&gt;&lt;dc:title&gt;${escapeXml(title)}&lt;/dc:title&gt;&lt;upnp:class&gt;${itemClass}&lt;/upnp:class&gt;&lt;res protocolInfo=&quot;http-get:*:${escapeXml(contentType)}:*&quot;&gt;${escapeXml(mediaUrl)}&lt;/res&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;`;
}

export function buildSoapEnvelope(action: DlnaAction, serviceType: string, mediaUrl?: string, metadata = "", seekTarget = "00:00:00") {
  const body =
    action === "SetAVTransportURI"
      ? `<u:SetAVTransportURI xmlns:u="${serviceType}"><InstanceID>0</InstanceID><CurrentURI>${escapeXml(mediaUrl ?? "")}</CurrentURI><CurrentURIMetaData>${metadata}</CurrentURIMetaData></u:SetAVTransportURI>`
      : action === "Seek"
        ? `<u:Seek xmlns:u="${serviceType}"><InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${seekTarget}</Target></u:Seek>`
        : `<u:${action} xmlns:u="${serviceType}"><InstanceID>0</InstanceID>${action === "Play" ? "<Speed>1</Speed>" : ""}</u:${action}>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendSoap(controlUrl: string, serviceType: string, action: DlnaAction, mediaUrl?: string, metadata = "") {
  const response = await fetch(controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPACTION: `"${serviceType}#${action}"`
    },
    body: buildSoapEnvelope(action, serviceType, mediaUrl, metadata)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`DLNA ${action} 실패: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
  }
}

async function getDlnaService(location?: string) {
  if (!location) {
    throw new Error("DLNA description location이 없어 AVTransport controlURL을 찾을 수 없습니다.");
  }

  const response = await fetch(location);
  if (!response.ok) {
    throw new Error(`DLNA description 요청 실패: HTTP ${response.status}`);
  }

  const descriptionXml = await response.text();
  const service = extractDlnaAvTransportService(descriptionXml, location);
  if (!service) {
    throw new Error("DLNA AVTransport service/controlURL을 찾지 못했습니다.");
  }

  return service;
}

export const dlnaConnector: TVConnector = {
  kind: "dlna",
  canHandle(device, options) {
    const protocols = device.protocols ?? [device.protocol];
    return protocols.includes("DLNA") && (options.action === "play-dlna-media" || options.action === "connect" || !options.action);
  },
  async connect(context: ConnectorContext): Promise<ConnectorResult> {
    const filePath = context.options.mediaFilePath;
    if (!filePath) {
      return {
        ok: false,
        status: "unsupported",
        message: "DLNA 재생에는 사용자가 선택한 로컬 미디어 파일이 필요합니다.",
        canFallback: true
      };
    }

    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "dlna",
      status: "media-server-starting",
      step: "DLNA media server",
      message: "로컬 미디어 서버를 시작하고 TV가 접근 가능한 URL을 생성합니다."
    });
    const media = await addMediaFile(filePath, context.device.ipAddress);

    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "dlna",
      status: "media-url-created",
      step: "DLNA media URL",
      message: "미디어 URL을 생성했습니다.",
      details: { fileName: media.fileName, mediaType: media.mediaType, contentType: media.contentType }
    });

    const service = await getDlnaService(context.device.location);
    activeDlnaControls.set(context.connectionId, service);
    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "dlna",
      status: "media-loading",
      step: "SetAVTransportURI",
      message: "DLNA TV에 SetAVTransportURI 요청을 보냅니다.",
      details: { controlUrl: service.controlUrl, serviceType: service.serviceType }
    });
    await sendSoap(service.controlUrl, service.serviceType, "SetAVTransportURI", media.url, buildDidlLiteMetadata(media.url, media.contentType, media.fileName));

    context.emit({
      connectionId: context.connectionId,
      deviceId: context.device.id,
      connector: "dlna",
      status: "media-loading",
      step: "Play",
      message: "DLNA TV에 Play 요청을 보냅니다."
    });
    await sendSoap(service.controlUrl, service.serviceType, "Play");

    return {
      ok: true,
      status: "playing",
      message: "DLNA 미디어 재생 요청을 보냈습니다. TV 코덱 지원 여부에 따라 재생이 실패할 수 있습니다.",
      canFallback: false,
      details: { fileName: media.fileName, mediaType: media.mediaType }
    };
  },
  async stop(connectionId): Promise<ConnectorResult> {
    const service = activeDlnaControls.get(connectionId);
    if (service) {
      await sendSoap(service.controlUrl, service.serviceType, "Stop").catch(() => undefined);
      activeDlnaControls.delete(connectionId);
    }

    return {
      ok: true,
      status: "stopped",
      message: "DLNA Stop 요청을 처리했습니다.",
      canFallback: false
    };
  }
};
