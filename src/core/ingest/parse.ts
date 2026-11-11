import type { ParsedImport, SourceFormat } from "../model";
import { ImportFormatError, type ParseOptions, isRecord } from "./build";
import {
  isChatlogKeeperQQ,
  isChatlogKeeperWechat,
  parseChatlogKeeper,
} from "./adapters/chatlogKeeper";
import {
  genericJsonLineRecords,
  genericJsonRecords,
  isGenericCsv,
  parseGenericCsv,
  parseGenericJson,
} from "./adapters/generic";
import { detectLinePattern, detectStacked, parsePlainText } from "./adapters/plainText";
import { isQQMht, isQQTxt, parseQQMht, parseQQTxt } from "./adapters/qq";
import {
  isWechatExporterJson,
  isWechatExporterTxt,
  parseWechatExporterJson,
  parseWechatExporterTxt,
} from "./adapters/wechatExporter";
import {
  isWxCliEnvelope,
  isWxCliLegacy,
  isWxCliMarkdown,
  isWxCliTxt,
  parseWxCliEnvelope,
  parseWxCliLegacy,
  parseWxCliMarkdown,
  parseWxCliTxt,
} from "./adapters/wxCli";

export const SUPPORTED_FORMATS_HINT =
  "支持：chatlog-keeper（微信 / QQ JSON）、WeChatExporter（JSON / TXT）、wx-cli（JSON / Markdown / TXT）、" +
  "QQ 消息管理器（TXT / MHT）、通用 CSV（时间,发送者,内容）、JSON 模板 [{time,sender,text}]、" +
  "备份 JSON（CreateTime / talker / msg）、纯文本（如「2024-01-02 21:03 小鹿: 内容」，或时间、发送者、正文各占一行）";

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function tryJson(content: string): unknown {
  const t = content.trim();
  if (!(t.startsWith("[") || t.startsWith("{"))) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function jsonFormat(root: unknown): SourceFormat | null {
  if (Array.isArray(root)) {
    if (isChatlogKeeperQQ(root)) return "qq-ntqq-json";
    if (isChatlogKeeperWechat(root)) return "wechat-chatlog-keeper-json";
    if (isWechatExporterJson(root)) return "wechat-exporter-json";
  } else if (isRecord(root)) {
    if (isWxCliEnvelope(root) || isWxCliLegacy(root)) return "wx-cli-json";
  }
  return genericJsonRecords(root) ? "generic-json" : null;
}

/** Identifies the export format, or null when it is not recognised. */
export function detectFormat(fileName: string, content: string): SourceFormat | null {
  const text = stripBom(content);
  if (isQQMht(fileName, text)) return "qq-mht";
  const json = tryJson(text);
  if (json !== undefined) return jsonFormat(json);

  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (isWechatExporterTxt(firstLine)) return "wechat-exporter-txt";
  if (isWxCliTxt(firstLine)) return "wx-cli-txt";
  if (isWxCliMarkdown(text)) return "wx-cli-markdown";
  if (isQQTxt(text)) return "qq-txt";
  if (isGenericCsv(text)) return "generic-csv";
  if (genericJsonLineRecords(text)) return "generic-json";
  const lines = text.split(/\r?\n/);
  if (detectLinePattern(lines) || detectStacked(lines)) return "plain-text";
  return null;
}

/**
 * Parses one export file (already decoded to text, see `decodeBytes`) into a
 * `ParsedImport`. Throws `ImportFormatError` with a user-facing message when
 * the format is unknown or no message could be read.
 */
export function parseImport(
  fileName: string,
  content: string,
  opts: ParseOptions = {},
): ParsedImport {
  const text = stripBom(content);
  if (!text.trim()) throw new ImportFormatError("文件是空的");
  const format = detectFormat(fileName, text);
  if (!format) {
    const hint = /\.(db|sqlite|dat)$/i.test(fileName)
      ? "这是加密的数据库文件，本产品不解密微信 / QQ 数据库，请先用导出工具导出为 JSON / TXT。"
      : "无法识别这个文件的聊天记录格式。";
    throw new ImportFormatError(`${hint}${SUPPORTED_FORMATS_HINT}`);
  }
  switch (format) {
    case "qq-mht":
      return parseQQMht(text, opts);
    case "qq-ntqq-json":
      return parseChatlogKeeper(tryJson(text) as unknown[], true, opts);
    case "wechat-chatlog-keeper-json":
      return parseChatlogKeeper(tryJson(text) as unknown[], false, opts);
    case "wechat-exporter-json":
      return parseWechatExporterJson(tryJson(text) as unknown[], opts);
    case "wx-cli-json": {
      const root = tryJson(text) as Record<string, unknown>;
      return isWxCliEnvelope(root) ? parseWxCliEnvelope(root, opts) : parseWxCliLegacy(root, opts);
    }
    case "generic-json": {
      const json = tryJson(text);
      if (json !== undefined) return parseGenericJson(json, opts);
      return parseGenericJson(genericJsonLineRecords(text) ?? [], opts);
    }
    case "wechat-exporter-txt":
      return parseWechatExporterTxt(text, opts);
    case "wx-cli-txt":
      return parseWxCliTxt(text, opts);
    case "wx-cli-markdown":
      return parseWxCliMarkdown(text, opts);
    case "qq-txt":
      return parseQQTxt(text, opts);
    case "generic-csv":
      return parseGenericCsv(text, opts);
    case "plain-text":
      return parsePlainText(text, opts);
  }
}

/**
 * Decodes raw file bytes: UTF-8 (with or without BOM), UTF-16 with BOM (old QQ
 * TXT exports), falling back to GB18030 for legacy Windows exports.
 */
/**
 * Reads a file the user chose in the import dialog. Decodes UTF-8, UTF-16 and
 * GB18030, then parses. Does not open or decrypt WeChat / QQ databases.
 */
export function parseImportBytes(
  fileName: string,
  bytes: Uint8Array,
  opts: ParseOptions = {},
): ParsedImport {
  return parseImport(fileName, decodeBytes(bytes), opts);
}

export function decodeBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}
