// Which model a bridge Git generation flow (PR description / commit message)
// talks to. Pure so the choice is unit-tested without `vscode`; the catalog
// lookup is injected.
//
// Order: the request's explicit model, then the user's small-model override
// from OpenChamber settings (the same setting every other utility generation in
// the product uses), then zen when the catalog has it, then a catalog model
// (OpenCode free models first). Vanilla OpenCode installs often have no zen
// provider; sending zen/gpt-5-nano there hangs until the generation timeout.

export const BRIDGE_ZEN_DEFAULT_MODEL = 'gpt-5-nano';

export type BridgeGitGenerationPayloadModel = {
  providerId?: string;
  modelId?: string;
  zenModel?: string;
};

type BridgeGitGenerationModelChoice = { providerID: string; modelID: string };

const parseCatalogRef = (ref: string): BridgeGitGenerationModelChoice | null => {
  const separator = ref.indexOf('/');
  if (separator <= 0) return null;
  const providerID = ref.slice(0, separator).trim();
  const modelID = ref.slice(separator + 1).trim();
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
};

const compareCatalogChoice = (
  left: BridgeGitGenerationModelChoice,
  right: BridgeGitGenerationModelChoice,
): number => {
  const byProvider = left.providerID.localeCompare(right.providerID);
  if (byProvider !== 0) return byProvider;
  return left.modelID.localeCompare(right.modelID);
};

/**
 * When zen is missing from the live catalog, pick a model that actually exists.
 * Prefer OpenCode's free models so a machine with no provider keys still works.
 */
export const pickCatalogGitGenerationFallback = (
  refs: Iterable<string>,
): BridgeGitGenerationModelChoice | null => {
  const models: BridgeGitGenerationModelChoice[] = [];
  for (const ref of refs) {
    const parsed = parseCatalogRef(ref);
    if (parsed) models.push(parsed);
  }
  if (models.length === 0) return null;
  models.sort(compareCatalogChoice);
  const opencodeFree = models.find((model) => (
    model.providerID === 'opencode' && model.modelID.includes('free')
  ));
  if (opencodeFree) return opencodeFree;
  const opencode = models.find((model) => model.providerID === 'opencode');
  if (opencode) return opencode;
  return models[0];
};

// Bridge settings are the merged persisted dictionary; a value is a string
// only when the stored file says so, hence the narrowing here.
const readStringField = (settings: Record<string, unknown>, key: string): string => {
  const candidate = settings[key];
  return typeof candidate === 'string' ? candidate.trim() : '';
};

/**
 * `smallModelOverride` is stored as `provider/model`; the model id may itself
 * contain slashes, so only the first one separates the two.
 */
const readSmallModelOverride = (settings: Record<string, unknown>): BridgeGitGenerationModelChoice | null => {
  if (settings.smallModelUseDefault !== false) return null;
  const override = readStringField(settings, 'smallModelOverride');
  const separator = override.indexOf('/');
  if (separator <= 0) return null;
  const providerID = override.slice(0, separator).trim();
  const modelID = override.slice(separator + 1).trim();
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
};

export const chooseBridgeGitGenerationModel = (
  payloadModel: BridgeGitGenerationPayloadModel,
  settings: Record<string, unknown>,
  hasModel: (providerID: string, modelID: string) => boolean,
  catalogFallback?: BridgeGitGenerationModelChoice | null,
): BridgeGitGenerationModelChoice => {
  // The payload reaches here from a webview message that is cast, not parsed,
  // so a wrong-typed field must degrade to "absent" instead of throwing.
  const requestProviderId = typeof payloadModel.providerId === 'string' ? payloadModel.providerId.trim() : '';
  const requestModelId = typeof payloadModel.modelId === 'string' ? payloadModel.modelId.trim() : '';
  if (requestProviderId && requestModelId && hasModel(requestProviderId, requestModelId)) {
    return { providerID: requestProviderId, modelID: requestModelId };
  }

  const override = readSmallModelOverride(settings);
  if (override && hasModel(override.providerID, override.modelID)) {
    return override;
  }

  const payloadZenModel = typeof payloadModel.zenModel === 'string' ? payloadModel.zenModel.trim() : '';
  const settingsZenModel = readStringField(settings, 'zenModel');
  const zenChoice = {
    providerID: 'zen',
    modelID: payloadZenModel || settingsZenModel || BRIDGE_ZEN_DEFAULT_MODEL,
  };
  if (hasModel(zenChoice.providerID, zenChoice.modelID)) {
    return zenChoice;
  }
  if (catalogFallback) {
    return catalogFallback;
  }
  return zenChoice;
};
