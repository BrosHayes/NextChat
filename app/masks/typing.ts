import { ChatMessage, ModelConfig } from "../store";
import { type Mask } from "../store/mask";

export type BuiltinMask = Omit<
  Mask,
  "id" | "modelConfig" | "context" | "updatedAt"
> & {
  builtin: Boolean;
  modelConfig: Partial<ModelConfig>;
  context: Array<Partial<ChatMessage>>;
  updatedAt?: number;
};
