// Click Friday · lógica de la página.
// El tablero y la decisión de ganar viven en el servidor (Supabase):
// esta página solo registra, envía cada clic y muestra lo que responde.
(function () {
  "use strict";
  var CFG = window.CF_CONFIG || {};
  var CLICS = 12, POR_OPORTUNIDAD = 4, CASILLAS = 24;
  var ELEMENTOS = ["Tadet", "Neubalin", "Valatril", "Logo Hetero"];
  // Imágenes: WebP y, si el navegador no lo muestra, JPG/PNG de respaldo.
  var IMG = { Tadet: "assets/img/tadet.webp", Neubalin: "assets/img/neubalin.webp", Valatril: "assets/img/valatril.webp" };
  var IMG_RESPALDO = { Tadet: "assets/img/tadet.jpg", Neubalin: "assets/img/neubalin.jpg", Valatril: "assets/img/valatril.jpg" };
  var IMG_TAM = { Tadet: [276, 90], Neubalin: [267, 108], Valatril: [267, 86] };
  var LOGO = "assets/img/hetero.webp", LOGO_RESPALDO = "assets/img/hetero.png";
  function imgLogo(alt) {
    return '<img alt="' + alt + '" src="' + LOGO + '" width="192" height="159" data-respaldo="' + LOGO_RESPALDO + '">';
  }
  // Si un logo WebP no carga, se cambia una vez por su PNG de respaldo.
  document.addEventListener("error", function (ev) {
    var im = ev.target;
    if (im && im.tagName === "IMG" && im.dataset.respaldo && !im.dataset.usado) {
      im.dataset.usado = "1"; im.src = im.dataset.respaldo;
    }
  }, true);
  function icono(id) { return '<svg aria-hidden="true" focusable="false"><use href="#' + id + '"/></svg>'; }
  var LETRAS = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
  var RE_NOMBRE = new RegExp("^[" + LETRAS + "]+([ '-][" + LETRAS + "]+)*$");
  // Droguería: campo abierto; sin caracteres de control, con alguna letra o
  // número, y sin =, +, - o @ al inicio (Excel lo tomaría como fórmula).
  function drogueriaValida(s) {
    return s.length >= 2 && s.length <= 100 && !/[\u0000-\u001F\u007F]/.test(s) &&
      new RegExp("[" + LETRAS + "0-9]").test(s) && !/^[=+@-]/.test(s);
  }

  var $ = function (id) { return document.getElementById(id); };
  var token = null, solicitud = null, abiertas = {}, clics = 0, ocupado = false, terminado = false;

  // ---------- utilidades ----------
  function limpiarTexto(s) {
    return String(s || "").normalize("NFC")
      .replace(/[’‘´`]/g, "'")
      .replace(/[‐-—]/g, "-")
      .replace(/[ \t\r\n]/g, " ")
      .replace(/ {2,}/g, " ").trim();
  }
  function normalizarCelular(s) {
    var d = String(s || "").replace(/\D/g, "");
    if (d.length === 14 && d.indexOf("0057") === 0) d = d.slice(4);
    else if (d.length === 12 && d.indexOf("57") === 0) d = d.slice(2);
    return d;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function esHttps(u) { return /^https:\/\/[^\s"'<>]+$/i.test(u || ""); }
  function go(n) {
    ["s0", "s1", "s2", "s3"].forEach(function (s, i) { $(s).classList.toggle("hide", i !== n); });
    document.body.classList.toggle("inicio", n === 0);
    window.scrollTo(0, 0);
  }
  function mensaje(cont, tipo, texto, reintentar) {
    cont.innerHTML = "";
    if (!texto) return;
    var p = document.createElement("div");
    p.className = "msg " + tipo;
    p.textContent = texto;
    cont.appendChild(p);
    if (reintentar) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "btn sec"; b.textContent = "Reintentar";
      b.onclick = reintentar;
      cont.appendChild(b);
    }
  }

  // ---------- servidor ----------
  var TEXTOS_ERROR = {
    ya_participo: "Este celular ya participó.",
    celular: "Escribe un celular colombiano de 10 dígitos que empiece por 3.",
    nombre: "Escribe tu nombre solo con letras (se permiten tildes, ñ, espacios, apóstrofe y guion).",
    drogueria: "Escribe el nombre de la droguería (de 2 a 100 caracteres, sin empezar por =, +, - o @).",
    representante: "Selecciona tu representante Hetero de la lista.",
    acepta: "Debes aceptar los términos y condiciones y el tratamiento de tus datos personales para poder jugar.",
    token: "Esta participación ya no está activa. Recuerda que hay una sola participación por persona.",
    terminada: "Tu participación ya terminó.",
    posicion: "Esa casilla no es válida.",
    red: "No pudimos conectarnos. Revisa tu internet y toca «Reintentar».",
    servidor: "Hubo un problema al guardar tu jugada. Toca «Reintentar».",
    config: "El juego todavía no está disponible. Intenta más tarde."
  };

  function rpc(nombre, cuerpo) {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_PUBLISHABLE_KEY) return Promise.reject({ codigo: "config" });
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    return fetch(CFG.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/rpc/" + nombre, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify(cuerpo),
      signal: ctrl ? ctrl.signal : undefined,
      cache: "no-store"
    }).then(function (r) {
      clearTimeout(t);
      return r.text().then(function (txt) {
        var datos = null;
        try { datos = txt ? JSON.parse(txt) : null; } catch (e) { /* respuesta no JSON */ }
        if (r.ok && datos) return datos;
        var m = datos && typeof datos.message === "string" && datos.message.match(/^CF:(\w+)/);
        throw { codigo: m ? m[1] : "servidor" };
      });
    }, function () {
      clearTimeout(t);
      throw { codigo: "red" };
    });
  }

  // ---------- inicio ----------
  // El inicio del juego cuenta desde «Quiero jugar» (incluye el formulario). Se mide
  // con un cronómetro interno del navegador, que no depende del reloj del equipo;
  // el servidor resta esos segundos de su propia hora.
  var inicioFormulario = null;
  $("jugar").onclick = function () { inicioFormulario = performance.now(); go(1); $("n").focus(); };

  // ---------- registro ----------
  var campos = ["n", "d", "t", "rep", "ok"];
  function chk() {
    $("go").disabled = ocupado || !($("n").value.trim() && $("d").value.trim() && $("t").value.trim() && $("rep").value && $("ok").checked);
    $("er").style.display = $("ok").checked ? "none" : "";
  }
  campos.forEach(function (i) { $(i).addEventListener("input", chk); $(i).addEventListener("change", chk); });

  function errorCampo(id, texto) {
    var e = $(id + "-er");
    e.textContent = texto || "";
    e.classList.toggle("hide", !texto);
    $(id).setAttribute("aria-invalid", texto ? "true" : "false");
  }
  function validar() {
    var nombre = limpiarTexto($("n").value), drog = limpiarTexto($("d").value), cel = normalizarCelular($("t").value);
    var okN = nombre.length >= 2 && nombre.length <= 80 && RE_NOMBRE.test(nombre);
    var okD = drogueriaValida(drog);
    var okT = /^3\d{9}$/.test(cel);
    errorCampo("n", okN ? "" : TEXTOS_ERROR.nombre);
    errorCampo("d", okD ? "" : TEXTOS_ERROR.drogueria);
    errorCampo("t", okT ? "" : TEXTOS_ERROR.celular);
    if (!okN) $("n").focus(); else if (!okD) $("d").focus(); else if (!okT) $("t").focus();
    return okN && okD && okT ? { nombre: nombre, drogueria: drog, telefono: cel } : null;
  }

  // Si la persona corrige sus datos después de un intento fallido, el siguiente
  // intento es una solicitud nueva.
  ["n", "d", "t", "rep"].forEach(function (i) { $(i).addEventListener("input", function () { solicitud = null; }); });

  function registrar() {
    if (ocupado) return;
    if (!$("ok").checked || !$("rep").value) { chk(); return; }
    var datos = validar();
    if (!datos) return;
    if (!solicitud) solicitud = uuid();
    ocupado = true; chk();
    $("go").textContent = "Guardando…";
    $("go").classList.add("cargando");
    mensaje($("regmsg"), "i", "");
    rpc("cf_iniciar", {
      p_nombre: datos.nombre, p_drogueria: datos.drogueria, p_telefono: datos.telefono,
      p_representante: $("rep").value, p_acepta: $("ok").checked, p_solicitud: solicitud,
      p_segundos_formulario: inicioFormulario === null ? null : Math.round((performance.now() - inicioFormulario) / 1000)
    }).then(function (r) {
      if (!r || !r.token) throw { codigo: "servidor" };
      token = r.token;
      iniciarTablero(datos);
      go(2);
      $("b").children[0].focus({ preventScroll: true }); // accesibilidad: el teclado sigue en el tablero
    }).catch(function (e) {
      var c = (e && e.codigo) || "servidor";
      if (c === "celular" || c === "nombre" || c === "drogueria") {
        errorCampo(c === "celular" ? "t" : c === "nombre" ? "n" : "d", TEXTOS_ERROR[c]);
      }
      var reintento = c === "red" || c === "servidor" ? registrar : null;
      mensaje($("regmsg"), "e", TEXTOS_ERROR[c] || TEXTOS_ERROR.servidor, reintento);
    }).then(function () {
      ocupado = false;
      $("go").textContent = "Empezar a jugar";
      $("go").classList.remove("cargando");
      chk();
    });
  }
  $("form").addEventListener("submit", function (ev) { ev.preventDefault(); registrar(); });

  // Enlaces legales y configuración pendiente.
  (function legales() {
    var partes = [], faltan = [];
    function enlace(url, texto) {
      var a = document.createElement("a");
      a.href = url; a.textContent = texto; a.target = "_blank"; a.rel = "noopener noreferrer";
      return a;
    }
    if (esHttps(CFG.POLITICA_DATOS_URL)) partes.push(enlace(CFG.POLITICA_DATOS_URL, "Política de Tratamiento de Datos Personales"));
    var canal = String(CFG.CANAL_DERECHOS || "").trim();
    if (/^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(canal)) partes.push(enlace("mailto:" + canal, "Ejercer mis derechos: " + canal));
    else if (esHttps(canal)) partes.push(enlace(canal, "Ejercer mis derechos sobre mis datos"));
    else faltan.push("canal para ejercer los derechos sobre los datos");
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_PUBLISHABLE_KEY) faltan.push("conexión con la base de datos");

    var p = $("links");
    partes.forEach(function (a, i) { if (i) p.appendChild(document.createTextNode(" · ")); p.appendChild(a); });
    p.classList.toggle("hide", !partes.length);
    if (faltan.length && window.console) console.warn("PENDIENTE: BLOQUEA PUBLICACIÓN →", faltan.join(" | "));
  })();

  // Ventana de términos y condiciones (solo texto; la X, Esc o tocar fuera la cierran).
  (function terminos() {
    var dlg = $("tyc"), abrir = $("tyc-abrir");
    if (!dlg || !abrir || typeof dlg.showModal !== "function") return;
    abrir.addEventListener("click", function () { dlg.showModal(); dlg.querySelector(".tyc-txt").scrollTop = 0; });
    $("tyc-cerrar").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (ev) { if (ev.target === dlg) dlg.close(); });
  })();

  // ---------- juego ----------
  function iniciarTablero(datos) {
    abiertas = {}; clics = 0; terminado = false; ocupado = false;
    $("who-n").textContent = datos.nombre;
    $("who-d").textContent = datos.drogueria;
    var b = $("b");
    b.innerHTML = "";
    for (var i = 0; i < CASILLAS; i++) {
      var e = document.createElement("button");
      e.type = "button";
      e.className = "cell";
      e.dataset.pos = i;
      e.setAttribute("aria-label", "Casilla " + (i + 1) + ", fila " + (Math.floor(i / 4) + 1) + ", columna " + (i % 4 + 1) + ", cerrada");
      e.innerHTML = imgLogo("");
      e.onclick = (function (pos) { return function () { clic(pos); }; })(i);
      b.appendChild(e);
    }
    hud();
  }

  function hud() {
    var o = Math.min(Math.floor(clics / POR_OPORTUNIDAD), 2);
    $("left").textContent = "Clics restantes: " + (CLICS - clics);
    $("opp").innerHTML = [0, 1, 2].map(function (i) {
      return '<div class="' + (i === o && !terminado ? "on" : i < o ? "past" : "") + '">Oportunidad ' + (i + 1) + "</div>";
    }).join("");
    var cuenta = {};
    ELEMENTOS.forEach(function (x) { cuenta[x] = 0; });
    Object.keys(abiertas).forEach(function (k) { if (cuenta[abiertas[k]] !== undefined) cuenta[abiertas[k]]++; });
    $("cnt").innerHTML = ELEMENTOS.map(function (x) {
      return '<div' + (cuenta[x] === 2 ? ' class="casi"' : "") + ">" + (x === "Logo Hetero" ? "Hetero" : x) + "<b>" + cuenta[x] + " / 3</b></div>";
    }).join("");
  }

  function pintar(pos, elem, atenuar) {
    var e = $("b").children[pos];
    var t = elem === "vacio" ? "s" : elem === "Logo Hetero" ? "l" : "p";
    // Lo que destapó la persona (producto o logo) lleva borde verde y ✓; lo que se
    // muestra al final (atenuado) no, porque la ✓ significa «lo encontraste».
    var hallado = t !== "s" && !atenuar;
    e.className = "cell open " + t + (atenuar ? " dim" : "") + (hallado ? " hallado" : "");
    e.disabled = true;
    if (t === "p") {
      e.innerHTML = "";
      var img = document.createElement("img");
      img.className = "pi"; img.alt = elem; img.width = IMG_TAM[elem][0]; img.height = IMG_TAM[elem][1];
      img.onerror = function () {
        if (img.src.indexOf(".webp") > -1) img.src = IMG_RESPALDO[elem];
        else e.textContent = elem; // respaldo final: el nombre en texto
      };
      img.src = IMG[elem];
      e.appendChild(img);
      if (hallado) e.insertAdjacentHTML("beforeend", marca());
    } else if (t === "s") {
      e.textContent = "😢";
    } else {
      e.innerHTML = imgLogo("Logo Hetero") + (hallado ? marca() : "");
    }
    e.setAttribute("aria-label", "Casilla " + (pos + 1) + ": " + (elem === "vacio" ? "vacía" : elem));
  }

  function marca() { return '<span class="marca">' + icono("i-check") + "</span>"; }

  function clic(pos) {
    if (ocupado || terminado || !token || abiertas[pos] !== undefined) return;
    ocupado = true;
    $("b").classList.add("wait");
    var cel = $("b").children[pos];
    cel.classList.add("load");
    mensaje($("gamemsg"), "i", "");
    rpc("cf_clic", { p_token: token, p_pos: pos }).then(function (j) {
      cel.classList.remove("load");
      aplicar(j);
      // Accesibilidad: la casilla abierta queda desactivada; el foco del teclado
      // pasa a la siguiente casilla tapada en lugar de perderse.
      if (!terminado && (document.activeElement === document.body || document.activeElement === cel)) {
        var celdas = $("b").children;
        for (var k = 1; k < CASILLAS; k++) {
          var sig = celdas[(pos + k) % CASILLAS];
          if (!sig.disabled) { sig.focus({ preventScroll: true }); break; }
        }
      }
    }).catch(function (e) {
      cel.classList.remove("load");
      var c = (e && e.codigo) || "servidor";
      if (c === "red" || c === "servidor") {
        // Se reintenta el MISMO clic: el servidor no lo cuenta dos veces.
        mensaje($("gamemsg"), "e", TEXTOS_ERROR[c], function () { ocupado = false; clic(pos); });
      } else {
        terminado = true;
        mensaje($("gamemsg"), "e", TEXTOS_ERROR[c] || TEXTOS_ERROR.servidor);
      }
    }).then(function () {
      if (!document.querySelector("#gamemsg .btn")) ocupado = false;
      $("b").classList.remove("wait");
    });
  }

  function aplicar(j) {
    if (!j || typeof j.pos !== "number") throw { codigo: "servidor" };
    abiertas[j.pos] = j.elemento;
    pintar(j.pos, j.elemento);
    clics = j.clics;
    if (j.estado === "jugando") { hud(); return; }

    terminado = true;
    hud();
    if (j.estado === "gano") {
      Object.keys(abiertas).forEach(function (k) {
        if (abiertas[k] === j.producto_ganador) $("b").children[k].classList.add("win");
      });
      setTimeout(function () { resultado(true, j.producto_ganador); }, 1600);
    } else {
      (j.tablero || []).forEach(function (elem, k) { if (abiertas[k] === undefined) pintar(k, elem, true); });
      setTimeout(function () { resultado(false); }, 2200);
    }
    Array.prototype.forEach.call($("b").children, function (e) { e.disabled = true; });
  }

  // ---------- resultado (solo se muestra lo que el servidor ya guardó) ----------
  function resultado(gano, prod) {
    var bu = $("bu");
    if (gano) bu.innerHTML = icono("i-trofeo"); else bu.textContent = "Uy...";
    bu.classList.toggle("trofeo", !!gano);
    $("s3").classList.toggle("gana", !!gano);
    $("s3").classList.toggle("pierde", !gano);
    $("rt").textContent = gano ? "¡BIEN HECHO ACERTASTE!" : "Casi lo logras";
    $("rt").className = "H " + (gano ? "win-t" : "lose-t");
    $("rs").textContent = gano
      ? (prod === "Logo Hetero" ? "Encontraste el logo Hetero 3 veces." : "Encontraste " + prod + " 3 veces.") + " Un asesor de Hetero te contactará."
      : "Se acabaron tus 12 clics. ¡Gracias por participar!";
    go(3);
    if (gano) confeti(); else lluvia();
  }

  // Confeti con los colores de las marcas (Hetero, Tadet, Neubalin, Valatril).
  // Solo decorativo (dura unos 4 segundos y no recibe toques).
  // Al perder: caen algunas caritas 😢 (también decorativo).
  function lluvia() {
    var capa = document.createElement("div");
    capa.className = "confeti"; capa.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 12; i++) {
      var p = document.createElement("i");
      p.className = "emoji"; p.textContent = "😢";
      p.style.left = (Math.random() * 92) + "%";
      p.style.animationDelay = (0.3 + Math.random() * 1.6) + "s";
      p.style.animationDuration = (2.6 + Math.random() * 1.4) + "s";
      p.style.setProperty("--giro", (Math.random() * 60 - 30) + "deg");
      p.style.setProperty("--deriva", (Math.random() * 40 - 20) + "px");
      capa.appendChild(p);
    }
    document.body.appendChild(capa);
    setTimeout(function () { if (capa.parentNode) capa.parentNode.removeChild(capa); }, 4500);
  }

  function confeti() {
    var capa = document.createElement("div"), colores = ["c1", "c2", "c3", "c4", "c5"];
    capa.className = "confeti"; capa.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 110; i++) {
      var p = document.createElement("i");
      p.className = colores[i % colores.length] + (i % 3 ? "" : " cinta");
      p.style.left = (Math.random() * 100) + "%";
      p.style.animationDelay = (Math.random() * (i < 70 ? 0.6 : 1.8)) + "s";
      p.style.animationDuration = (2.4 + Math.random() * 1.8) + "s";
      p.style.setProperty("--giro", (Math.random() * 720 - 360) + "deg");
      p.style.setProperty("--deriva", (Math.random() * 120 - 60) + "px");
      capa.appendChild(p);
    }
    document.body.appendChild(capa);
    setTimeout(function () { if (capa.parentNode) capa.parentNode.removeChild(capa); }, 5200);
  }

  chk();
})();
