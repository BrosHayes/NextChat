function isSafeKey(key: string) {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function merge(target: any, source: any) {
  if (!isPlainObject(source) || !isPlainObject(target)) {
    return;
  }

  Object.keys(source).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(source, key) || !isSafeKey(key)) {
      return;
    }

    const sourceValue = source[key];
    if (Array.isArray(sourceValue)) {
      target[key] = sourceValue.slice();
      return;
    }

    if (isPlainObject(sourceValue)) {
      const nextTarget = isPlainObject(target[key]) ? target[key] : {};
      target[key] = nextTarget;
      merge(nextTarget, sourceValue);
      return;
    }

    target[key] = sourceValue;
  });
}
