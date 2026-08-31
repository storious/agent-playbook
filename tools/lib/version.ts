import packageMetadata from "../../package.json" with { type: "json" };

/** The Agulater release version embedded by Bun in standalone executables. */
export const agulaterVersion = packageMetadata.version;
