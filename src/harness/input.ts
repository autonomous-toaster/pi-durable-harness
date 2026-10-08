/**
 * Map RPC prompt content into durable user content (task 3.5). Durable's input
 * type is `UserMessage["content"]`, which admits text and image blocks, so pi's
 * `ImageContent` values pass through unchanged.
 */
export function toUserContent(message: string, images: readonly unknown[] | undefined): string | readonly unknown[] {
	if (images === undefined || images.length === 0) return message;
	return [{ type: "text", text: message }, ...images];
}
