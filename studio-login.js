(() => {
  const style = document.createElement('style');
  style.textContent = '.studio-auth{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#071126;color:white;font:16px system-ui}.studio-auth form{width:min(360px,85vw);padding:28px;border:1px solid #ffffff40;border-radius:18px;background:#10213f}.studio-auth label{display:block;margin:16px 0}.studio-auth input:not([type=checkbox]){display:block;box-sizing:border-box;width:100%;padding:12px;margin-top:6px}.studio-auth button{padding:12px;width:100%;cursor:pointer}.studio-auth[hidden]{display:none}';
  document.head.appendChild(style);
  const gate = document.createElement('section');
  gate.className = 'studio-auth';
  gate.innerHTML = '<form><h1>Magic Studio</h1><p>Connectez-vous pour accéder au studio.</p><label>Identifiant<input name="username" autocomplete="username" required></label><label>Mot de passe<input name="code" type="password" autocomplete="current-password" required></label><label><input name="remember" type="checkbox"> Mémoriser cet appareil</label><button>Se connecter</button><p role="status"></p></form>';
  document.body.appendChild(gate);
  const form = gate.querySelector('form'), status = gate.querySelector('[role=status]');
  function showStudioAccount(username){const control=document.createElement('button');control.type='button';control.textContent=username+' · Se déconnecter';control.style.cssText='position:fixed;right:12px;bottom:12px;z-index:9000;padding:9px 14px;border-radius:12px;cursor:pointer';control.onclick=async()=>{const response=await fetch('/api/session',{method:'DELETE',credentials:'same-origin'});if(response.ok||response.status===401)location.reload()};document.body.appendChild(control)}
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const input = args[0], url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/') && response.status === 401) gate.hidden = false;
    return response;
  };
  form.onsubmit = async event => {
    event.preventDefault(); form.querySelector('button').disabled = true; status.textContent = 'Connexion…';
    try {
      const response = await originalFetch('/api/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify({username: form.elements.username.value.trim(), code: form.elements.code.value, remember: form.elements.remember.checked})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Connexion refusée.');
      form.elements.code.value = ''; location.reload();
    } catch (error) { status.textContent = error.message; }
    finally { form.querySelector('button').disabled = false; }
  };
  originalFetch('/api/session', {credentials: 'same-origin', cache: 'no-store'}).then(async response => {gate.hidden = response.ok;if(response.ok){const account=await response.json();showStudioAccount(account.username);}}).catch(() => {status.textContent = 'Connexion au serveur indisponible.';});
})();
