const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();
const BOT_TOKEN = process.env.TELEGRAM_MODERATION_TOKEN;
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 200, body: "ok" };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 200, body: "ok" }; }

  const query = body.callback_query;
  if (!query) return { statusCode: 200, body: "ok" };

  const [action, taskId] = query.data.split("_");
  if (!taskId || !["approve","reject"].includes(action)) return { statusCode: 200, body: "ok" };

  const taskRef = db.collection("tasks").doc(taskId);
  const snap = await taskRef.get();
  if (!snap.exists) return { statusCode: 200, body: "ok" };

  await taskRef.update({ status: action === "approve" ? "open" : "rejected" });

  await fetch(`${TG}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: query.id,
      text: action === "approve" ? "✅ Опубликовано" : "❌ Отклонено"
    })
  });

  return { statusCode: 200, body: "ok" };
};
