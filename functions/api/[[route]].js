/**
 * Cloudflare Pages Functions: Full REST API for Retro Fruit Master
 */
const SEED_NPCS = [
  { username: '广州靓仔 (老街机王)', credits: 6880, max_win: 2400 },
  { username: '水果大亨 (老八)', credits: 5200, max_win: 1800 },
  { username: '小玛莉连胜仙人', credits: 4150, max_win: 1600 },
  { username: '幸运星晴天', credits: 3200, max_win: 1200 },
  { username: '街机神偷', credits: 2480, max_win: 960 },
  { username: '流星追梦人', credits: 1880, max_win: 800 }
];

async function ensureTable(db) {
  if (!db) return;
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT,
        credits INTEGER DEFAULT 100,
        max_win INTEGER DEFAULT 0,
        last_daily_date TEXT,
        created_at INTEGER
      );
    `);
    const countRes = await db.prepare("SELECT COUNT(*) as c FROM users").first();
    if (countRes && countRes.c === 0) {
      for (const npc of SEED_NPCS) {
        await db.prepare(
          "INSERT OR IGNORE INTO users (username, password, credits, max_win, last_daily_date, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(npc.username, '123', npc.credits, npc.max_win, '', Date.now()).run();
      }
    }
  } catch (e) {
    console.error("D1 Init error:", e);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  const db = env.DB;
  if (db) {
    await ensureTable(db);
  }

  if (pathname === '/api/leaderboard' && request.method === 'GET') {
    if (db) {
      try {
        const { results } = await db.prepare(
          "SELECT username, credits, max_win FROM users ORDER BY credits DESC LIMIT 30"
        ).all();
        const mapped = (results || []).map(r => ({
          username: r.username,
          credits: Number(r.credits),
          maxWin: Number(r.max_win || 0)
        }));
        return new Response(JSON.stringify({ ok: true, leaderboard: mapped }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, msg: e.message }), { status: 500, headers });
      }
    } else {
      return new Response(JSON.stringify({ ok: true, leaderboard: SEED_NPCS.map(n => ({ username: n.username, credits: n.credits, maxWin: n.max_win })) }), { headers });
    }
  }

  let body = {};
  if (request.method === 'POST') {
    try { body = await request.json(); } catch (e) { body = {}; }
  }

  if (pathname === '/api/register' && request.method === 'POST') {
    const username = (body.username || '').trim();
    const password = body.password || '123';
    if (!username || username.length < 2) {
      return new Response(JSON.stringify({ ok: false, msg: '用户名至少2个字符！' }), { status: 400, headers });
    }

    if (db) {
      try {
        const existing = await db.prepare("SELECT username FROM users WHERE username = ?").bind(username).first();
        if (existing) {
          return new Response(JSON.stringify({ ok: false, msg: '该用户名已存在，请直接登录！' }), { status: 400, headers });
        }
        await db.prepare(
          "INSERT INTO users (username, password, credits, max_win, last_daily_date, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(username, password, 100, 0, '', Date.now()).run();

        const user = { username, credits: 100, maxWin: 0, lastDailyDate: '' };
        return new Response(JSON.stringify({ ok: true, user, msg: '注册成功！已发放初始新人金 100 块！' }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, msg: e.message }), { status: 500, headers });
      }
    } else {
      const user = { username, credits: 100, maxWin: 0, lastDailyDate: '' };
      return new Response(JSON.stringify({ ok: true, user, msg: '注册成功！新人赠送 100 块！' }), { headers });
    }
  }

  if (pathname === '/api/login' && request.method === 'POST') {
    const username = (body.username || '').trim();
    const password = body.password || '';

    if (db) {
      try {
        const row = await db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
        if (!row) {
          return new Response(JSON.stringify({ ok: false, msg: '用户不存在，请先注册！' }), { status: 400, headers });
        }
        if (row.password && row.password !== password) {
          return new Response(JSON.stringify({ ok: false, msg: '密码错误！' }), { status: 400, headers });
        }
        const user = {
          username: row.username,
          credits: Number(row.credits),
          maxWin: Number(row.max_win || 0),
          lastDailyDate: row.last_daily_date || ''
        };
        return new Response(JSON.stringify({ ok: true, user, msg: `欢迎回来，${username}！` }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, msg: e.message }), { status: 500, headers });
      }
    } else {
      const user = { username, credits: 100, maxWin: 0, lastDailyDate: '' };
      return new Response(JSON.stringify({ ok: true, user, msg: `登录成功！` }), { headers });
    }
  }

  if (pathname === '/api/daily-claim' && request.method === 'POST') {
    const username = (body.username || '').trim();
    if (!username) {
      return new Response(JSON.stringify({ ok: false, msg: '请先登录！' }), { status: 401, headers });
    }

    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    if (db) {
      try {
        const row = await db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
        if (!row) {
          return new Response(JSON.stringify({ ok: false, msg: '用户不存在！' }), { status: 400, headers });
        }
        if (row.last_daily_date === today) {
          return new Response(JSON.stringify({ ok: false, msg: '今天已经领取过每日福利了，明天再来吧！' }), { headers });
        }

        const newCredits = Number(row.credits) + 20;
        await db.prepare("UPDATE users SET credits = ?, last_daily_date = ? WHERE username = ?")
          .bind(newCredits, today, username).run();

        return new Response(JSON.stringify({
          ok: true,
          amount: 20,
          newCredits,
          msg: '每日签到成功！已领取 20 块，祝您手气长虹！'
        }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, msg: e.message }), { status: 500, headers });
      }
    } else {
      return new Response(JSON.stringify({ ok: true, amount: 20, newCredits: 120, msg: '每日签到成功 +20 块！' }), { headers });
    }
  }

  if (pathname === '/api/sync' && request.method === 'POST') {
    const username = (body.username || '').trim();
    const credits = body.credits;
    const maxWin = body.maxWin;

    if (db && username && typeof credits === 'number') {
      try {
        await db.prepare("UPDATE users SET credits = ?, max_win = MAX(max_win, ?) WHERE username = ?")
          .bind(credits, maxWin || 0, username).run();
      } catch (e) {
        console.error("Sync error:", e);
      }
    }
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  return new Response(JSON.stringify({ ok: false, msg: 'Not Found' }), { status: 404, headers });
}
