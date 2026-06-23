import protobuf from "protobufjs";
import { readFileSync } from "fs";

/**
 * Minimal ProtobufDecoder for legacy Antigravity .pb files.
 *
 * Antigravity's legacy protobuf format wraps the same JSON content
 * as the modern JSONL format but inside a protobuf envelope. This
 * decoder extracts the JSON payload and delegates to the standard
 * Antigravity parser.
 *
 * If the exact message schema is unavailable, it attempts auto-detection
 * by inspecting the binary header and known patterns.
 */
export class ProtobufDecoder {
	/**
	 * Decode a .pb file into an array of JSON-like lines.
	 * Returns null if decoding fails (file may not be valid protobuf).
	 */
	static decode(filePath: string): string[] | null {
		try {
			const buffer = readFileSync(filePath);

			// Quick header check: protobuf uses varint encoding starting with 0x08-0x0F or 0x10-0x17 patterns
			// Most .pb transcripts start with field number 1 (varint or length-delimited)
			if (buffer.length < 4) return null;

			// Try known schema patterns
			const lines = ProtobufDecoder.tryKnownSchemas(buffer);

			if (lines && lines.length > 0) {
				return lines;
			}

			// Fallback: treat the entire buffer as a single protobuf message
			// and attempt to decode with a generic wrapper
			const jsonContent = ProtobufDecoder.tryGenericDecode(buffer);
			if (jsonContent) {
				return jsonContent;
			}

			return null;
		} catch {
			return null;
		}
	}

	/**
	 * Try decoding with known Antigravity protobuf schemas.
	 * The schema wraps each transcript line as a repeated field inside
	 * a LogResponse or TranscriptEntry message.
	 */
	private static tryKnownSchemas(buffer: Buffer): string[] | null {
		// Define a minimal protobuf schema for Antigravity transcripts.
		// This matches the legacy format where each file is a sequence of
		// JSON-encoded LogEntry messages.
		const root = new protobuf.Root();

		try {
			// Common Antigravity protobuf schema (flat repeated entries)
			root.add(
				new protobuf.Type("LogEntry").add(
					new protobuf.Field("data", 1, "string"),
				),
			);

			root.add(
				new protobuf.Type("LogResponse").add(
					new protobuf.Field("entries", 1, "LogEntry", "repeated"),
				),
			);

			const LogResponseType = root.lookupType("LogResponse");
			const decoded = LogResponseType.decode(buffer);
			const entries = decoded as unknown as {
				entries?: Array<{ data?: string }>;
			};

			if (entries?.entries?.length) {
				return entries.entries
					.map((e) => e.data)
					.filter(
						(d): d is string => typeof d === "string" && d.trim().length > 0,
					);
			}
		} catch {
			// Schema didn't match, try alternate
		}

		// Try alternate schema: single JSON string in a data field
		try {
			const root2 = new protobuf.Root();
			root2.add(
				new protobuf.Type("Wrapper").add(
					new protobuf.Field("json", 1, "string"),
				),
			);

			const WrapperType = root2.lookupType("Wrapper");
			const decoded = WrapperType.decode(buffer);
			const wrapper = decoded as unknown as { json?: string };

			if (typeof wrapper?.json === "string" && wrapper.json.startsWith("{")) {
				// It's a single JSON object, return as a single line
				return [wrapper.json];
			}
		} catch {
			// Alternate schema didn't match either
		}

		return null;
	}

	/**
	 * Generic fallback: try to decode the protobuf buffer by reading
	 * string fields. This is a best-effort approach for unknown schemas.
	 */
	private static tryGenericDecode(buffer: Buffer): string[] | null {
		try {
			// Try to decode as a repeated string field (field number 1)
			// or as a single string field
			const root = new protobuf.Root();
			root.add(
				new protobuf.Type("GenericLog").add(
					new protobuf.Field("lines", 1, "string", "repeated"),
				),
			);

			const GenericLogType = root.lookupType("GenericLog");
			const decoded = GenericLogType.decode(buffer);
			const generic = decoded as unknown as { lines?: string[] };

			if (generic?.lines?.length) {
				return generic.lines.filter((l) => l.trim().length > 0);
			}
		} catch {
			// Generic decode failed
		}

		return null;
	}

	/**
	 * Check if a file appears to be a protobuf file.
	 */
	static isProtobufFile(filePath: string): boolean {
		return filePath.endsWith(".pb");
	}
}
