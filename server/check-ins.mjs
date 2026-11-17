export const checkInSchema = `
    CREATE TABLE IF NOT EXISTS training_check_in (
      workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      day TEXT NOT NULL,
      text TEXT NOT NULL,
      adjustment TEXT,
      wants_reply INTEGER NOT NULL,
      reply TEXT,
      saved_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, id)
    );
    CREATE INDEX IF NOT EXISTS training_check_in_recent ON training_check_in (workspace_id, saved_at DESC);
    CREATE INDEX IF NOT EXISTS training_check_in_day ON training_check_in (workspace_id, day, saved_at DESC)
      WHERE adjustment IS NOT NULL;
`;

export function createCheckIns(db) {
  const fields = 'id, day, text, adjustment, reply, saved_at AS "savedAt"';
  const list = db.prepare(`SELECT ${fields} FROM training_check_in WHERE workspace_id = ? ORDER BY saved_at DESC, rowid DESC LIMIT 30`);
  const onDay = db.prepare(`SELECT adjustment FROM training_check_in WHERE workspace_id = ? AND day = ?
    AND adjustment IS NOT NULL ORDER BY saved_at DESC, rowid DESC LIMIT 1`);
  const byId = db.prepare('SELECT day, text, adjustment, wants_reply FROM training_check_in WHERE workspace_id = ? AND id = ?');
  const add = db.prepare(`INSERT INTO training_check_in (workspace_id, id, day, text, adjustment, wants_reply, reply, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const remove = db.prepare('DELETE FROM training_check_in WHERE workspace_id = ? AND id = ?');

  async function state(workspace, day) {
    const entries = (await list.all(workspace)).map(({ adjustment, reply, ...row }) => ({
      ...row, ...(adjustment && { adjustment }), ...(reply && { reply }),
    }));
    return { entries, day, adjustment: (await onDay.get(workspace, day))?.adjustment ?? null };
  }
  return {
    state,
    save(workspace, entry, makeReply) {
      const { id, day, text, adjustment, wantsReply } = entry;
      return db.transaction(true, async () => {
        const previous = await byId.get(workspace, id);
        const value = previous
          ? previous.day === day && previous.text === text && previous.adjustment === adjustment && previous.wants_reply === Number(wantsReply)
          : Boolean((await add.run(workspace, id, day, text, adjustment, Number(wantsReply), wantsReply ? await makeReply() : null, new Date().toISOString())).changes);
        const result = value ? await state(workspace, day) : null;
        return result;
      });
    },
    async remove(workspace, id, day) {
      await remove.run(workspace, id);
      return await state(workspace, day);
    },
  };
}
