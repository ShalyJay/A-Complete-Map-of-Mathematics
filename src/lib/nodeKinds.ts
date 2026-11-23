/**
 * Node kinds of the vault-backed graph. Structure maps (domain → branch → field → subfield → topic)
 * have children; leaves are concepts and named results. Depth is the real tree depth and varies
 * (a theorem can sit under a field, subfield or MSC topic), so code asks the type, not the depth.
 */
export const LEAF_TYPES = new Set(["concept", "theorem", "axiom", "conjecture", "definition"]);
export const MAP_TYPES = new Set(["domain", "branch", "field", "subfield", "topic"]);

export const isLeafType = (type: string | undefined): boolean => !!type && LEAF_TYPES.has(type);
export const isMapType = (type: string | undefined): boolean => !type || !LEAF_TYPES.has(type);
