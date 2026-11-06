let csrfToken = null;
let currentUser = null;
let selectedType = null;
const $ = (id) => document.getElementById(id);
const labels = {
  "alistamento": ["ALISTAMENTO", "INGRESSO"],
  "oficiais": ["SELEÇÃO DE OFICIAIS", "LIDERANÇA"],
  "tropas-especiais": ["TROPAS ESPECIAIS", "ESPECIALIZAÇÃO"]
};
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3200);
}
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (csrfToken && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a solicitação.");
  return data;
}
function show(el, yes = true) { el.classList.toggle("hidden", !yes); }
function openForm(type) {
  if (!currentUser) { toast("Entre com sua conta Roblox para continuar."); $("loginBtn").focus(); return; }
  selectedType = type;
  $("formTitle").textContent = labels[type][0];
  $("formTag").textContent = labels[type][1];
  show($("unitWrap"), type === "tropas-especiais");
  $("applicationForm").reset();
  $("formMessage").textContent = "";
  show($("application"), true);
  $("application").scrollIntoView({ behavior: "smooth" });
}
async function loadAccount() {
  const data = await api("/api/my-inscriptions");
  $("myApplications").innerHTML = "";
  if (!data.inscriptions.length) {
    $("myApplications").textContent = "Você ainda não enviou nenhuma inscrição.";
    return;
  }
  for (const item of data.inscriptions) {
    const el = document.createElement("div"); el.className = "application-item";
    const left = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = labels[item.type]?.[0] || item.type;
    const date = document.createElement("small"); date.textContent = new Date(item.created_at).toLocaleString("pt-BR");
    left.append(title, date);
    const status = document.createElement("span"); status.className = "status"; status.textContent = item.status;
    el.append(left, status); $("myApplications").append(el);
  }
}
async function loadAdmin() {
  const status = $("statusFilter").value;
  const data = await api("/api/admin/inscriptions" + (status ? "?status=" + encodeURIComponent(status) : ""));
  const root = $("adminApplications"); root.innerHTML = "";
  if (!data.inscriptions.length) { root.textContent = "Nenhuma inscrição encontrada."; return; }
  for (const item of data.inscriptions) {
    const el = document.createElement("article"); el.className = "application-item";
    const left = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `#${item.id} • ${item.roblox_username} • ${labels[item.type]?.[0] || item.type}`;
    const meta = document.createElement("small");
    meta.textContent = `${item.status} • ${new Date(item.created_at).toLocaleString("pt-BR")} • Roblox ID: ${item.roblox_user_id}`;
    const answers = document.createElement("div"); answers.className = "answer-preview";
    answers.textContent = `Idade: ${item.answers.age}\nUnidade: ${item.unit || "—"}\nMotivo: ${item.answers.reason}\nExperiência: ${item.answers.experience || "—"}\nDisponibilidade: ${item.answers.availability}`;
    left.append(title, meta, answers);
    if (item.status === "Pendente") {
      const actions = document.createElement("div"); actions.className = "admin-actions";
      for (const status of ["Aprovado", "Reprovado"]) {
        const button = document.createElement("button"); button.className = "btn btn-outline"; button.textContent = status.toUpperCase();
        button.addEventListener("click", async () => {
          try { await api(`/api/admin/inscriptions/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); toast("Inscrição atualizada."); await loadAdmin(); }
          catch (e) { toast(e.message); }
        });
        actions.append(button);
      }
      left.append(actions);
    }
    el.append(left); root.append(el);
  }
}
async function init() {
  try {
    const data = await api("/api/me");
    currentUser = data.user; csrfToken = data.csrfToken;
    if (currentUser) {
      show($("loginBtn"), false); show($("logoutBtn"), true);
      $("userName").textContent = "@" + currentUser.username;
      show($("account"), true); await loadAccount();
      if (currentUser.isAdmin) { show($("admin"), true); await loadAdmin(); }
    }
  } catch (e) { toast(e.message); }
}
document.querySelectorAll("[data-type]").forEach(button => button.addEventListener("click", () => openForm(button.dataset.type)));
$("loginBtn").addEventListener("click", () => { location.href = "/auth/roblox"; });
$("logoutBtn").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); location.reload(); } catch (e) { toast(e.message); }
});
$("closeForm").addEventListener("click", () => show($("application"), false));
$("applicationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    type: selectedType,
    unit: form.get("unit") || "",
    answers: {
      age: form.get("age"), reason: form.get("reason"),
      experience: form.get("experience") || "", availability: form.get("availability")
    }
  };
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true; submit.textContent = "ENVIANDO...";
  try {
    await api("/api/inscriptions", { method: "POST", body: JSON.stringify(payload) });
    $("formMessage").textContent = "Inscrição enviada! Acompanhe o status na área do candidato.";
    event.currentTarget.reset(); await loadAccount(); show($("account"), true);
  } catch (e) { $("formMessage").textContent = e.message; }
  finally { submit.disabled = false; submit.innerHTML = "ENVIAR INSCRIÇÃO <b>↗</b>"; }
});
$("refreshAdmin").addEventListener("click", () => loadAdmin().catch(e => toast(e.message)));
$("statusFilter").addEventListener("change", () => loadAdmin().catch(e => toast(e.message)));
init();
