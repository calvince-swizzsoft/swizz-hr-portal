const preferredIds = new Map([
  ['annual leave', '20000000-0000-4000-8000-000000000001'],
  ['compassionate leave', '24000000-0000-4000-8000-000000000001'],
  ['maternity leave', '24000000-0000-4000-8000-000000000002'],
  ['paternity leave', '24000000-0000-4000-8000-000000000003'],
]);

export function uniqueLeaveTypes(types) {
  const byName = new Map();
  for (const type of Array.isArray(types) ? types : []) {
    if (!type?.Id || !type?.Description) continue;
    const key = type.Description.trim().toLocaleLowerCase();
    if (!key) continue;
    const current = byName.get(key);
    const preferredId = preferredIds.get(key);
    const score = Number(type.Id === preferredId) * 2
      + Number(type.Description === 'Annual leave') * 3;
    const currentScore = current
      ? Number(current.Id === preferredId) * 2 + Number(current.Description === 'Annual leave') * 3
      : -1;
    if (!current || score > currentScore) byName.set(key, type);
  }
  return [...byName.values()].sort((left, right) => left.Description.localeCompare(right.Description));
}
