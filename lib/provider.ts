// ============================================================================
// provider — the cloud-terminology seam. All provider-specific nouns
// (vector store, compute unit, managed retrieval service, model API) live here
// so UI copy stays provider-neutral and a second provider (Azure AI Search,
// GCP Vertex) can be added without touching component copy.
//
// Only AWS is implemented today; the pricing/engine layer is still AWS-shaped.
// This centralizes the vocabulary so that work is incremental, not a rewrite.
// ============================================================================

export interface ProviderTerminology {
  id: string;
  label: string; // "AWS"
  vectorStore: string; // "OpenSearch Serverless"
  computeUnit: string; // "OCU"
  managedService: string; // "Bedrock Knowledge Bases"
  managedServiceShort: string; // "Bedrock KB"
  modelApi: string; // "Bedrock"
  /** Plain-language names for the two build strategies. */
  selfBuiltName: string; // "Self-built"
  managedName: string; // "Managed retrieval"
  selfBuiltDesc: string;
  managedDesc: string;
}

export const PROVIDERS: Record<string, ProviderTerminology> = {
  aws: {
    id: "aws",
    label: "AWS",
    vectorStore: "OpenSearch Serverless",
    computeUnit: "OCU",
    managedService: "Bedrock Knowledge Bases",
    managedServiceShort: "Bedrock KB",
    modelApi: "Bedrock",
    selfBuiltName: "Self-built",
    managedName: "Managed retrieval",
    selfBuiltDesc: "DIY retrieval (OpenSearch Serverless) + model API. Fully priced.",
    managedDesc: "Bedrock Knowledge Bases handles chunking, embedding, and retrieval for you.",
  },
};

/** The provider whose pricing/terminology is active. AWS today. */
export const activeProvider: ProviderTerminology = PROVIDERS.aws;
