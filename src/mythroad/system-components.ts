import manifest from "../../assets/mythroad-manifest.json";

/** Files bundled with both production web builds and collection tests. */
export const SYSTEM_COMPONENTS: readonly string[] = manifest.files.map(file => file.path);
