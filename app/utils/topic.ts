export function trimTopic(topic: string) {
  // Fix an issue where double quotes still show in the Indonesian language
  // This will remove the specified punctuation from the end of the string
  // and also trim quotes from both the start and end if they exist.
  return (
    topic
      // fix for gemini
      .replace(/^["鈥溾€?]+|["鈥溾€?]+$/g, "")
      .replace(/[锛屻€傦紒锛熲€濃€?銆?.!?*]*$/, "")
  );
}

export function normalizeGeneratedTopic(topic: string) {
  const cleanedTopic = trimTopic(topic).replace(/\s+/g, " ").trim();

  if (!cleanedTopic) {
    return "";
  }

  if (/\s/.test(cleanedTopic)) {
    return cleanedTopic.split(" ").slice(0, 10).join(" ");
  }

  return Array.from(cleanedTopic).slice(0, 10).join("");
}
