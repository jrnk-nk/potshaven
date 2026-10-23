function invalidSettings() {
  const error = new Error('The workspace database settings are incomplete.');
  error.code = 'WORKSPACE_SCHEMA_INVALID';
  return error;
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function decodedObject(value) {
  for (let depth = 0; depth < 4 && typeof value === 'string'; depth++) {
    try { value = JSON.parse(value); }
    catch { throw invalidSettings(); }
  }
  if (!object(value)) throw invalidSettings();
  return value;
}

/** Decode only the shapes produced by the previous double-encoded JSON binds. */
export function normalizeLegacySettings(value) {
  if (object(value)) return value;
  if (typeof value === 'string') return decodedObject(value);
  if (!Array.isArray(value) || !value.length) throw invalidSettings();
  // jsonb object || jsonb string appended each settings patch to an array.
  // Preserve the original object and apply every later patch in order.
  return value.reduce((settings, patch) => ({...settings, ...decodedObject(patch)}), {});
}

const repairSQL = `WITH original AS MATERIALIZED (
  SELECT value FROM potshaven_private.metadata
  WHERE key = 'settings' AND value = $2::text::jsonb
  FOR UPDATE
), backup AS (
  INSERT INTO potshaven_private.metadata(key, value)
  SELECT 'settings-before-json-parameter-fix', value FROM original
  ON CONFLICT (key) DO NOTHING
)
UPDATE potshaven_private.metadata
SET value = $1::jsonb
WHERE key = 'settings' AND value = (SELECT value FROM original)
RETURNING value`;

/** Repair atomically without overwriting valid settings or concurrent edits. */
export async function repairLegacySettings(run) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = (await run("SELECT value, value::text AS original_json FROM potshaven_private.metadata WHERE key = 'settings'"))[0];
    if (object(row?.value)) return false;
    const repaired = normalizeLegacySettings(row?.value);
    // original_json is database-produced JSON text, explicitly bound as TEXT.
    // Only the new object is a JSONB parameter, serialized once by the driver.
    const updated = await run(repairSQL, [repaired, row.original_json]);
    if (updated.length) return true;
  }
  throw invalidSettings();
}
