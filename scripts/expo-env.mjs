process.env.EXPO_NO_DOTENV = '1';
delete process.env.CHATGPT_API_KEY;

// The web export otherwise bundles the entire Lucide icon library.
process.env.EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH ??= '1';
process.env.EXPO_UNSTABLE_TREE_SHAKING ??= process.env.EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH;
