/* Cacao: el mapa de negocios y sus cifras, todo leído de datos/negocios.json. */
(function () {
  "use strict";

  var ETIQUETAS = { comida: "Comida", tiendas: "Tiendas", servicios: "Servicios", hospedaje: "Hospedaje", cafe: "Cafés", otros: "Otros" };
  var ORDEN = ["comida", "tiendas", "servicios", "hospedaje", "cafe", "otros"];
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var MARGEN = 0.04;   // grados de aire alrededor del mapa
  var ESCALA = 100;    // unidades del viewBox por grado
  var FACTOR_LAT = 1.03;
  var NS = "http://www.w3.org/2000/svg";

  function cifra(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function fechaLarga(iso) {
    var p = String(iso).split("-");
    return Number(p[2]) + " de " + MESES[Number(p[1]) - 1] + " de " + p[0];
  }

  function poner(sel, valor) {
    document.querySelectorAll(sel).forEach(function (el) { el.textContent = valor; });
  }

  function dibujarMapa(cont, lugares) {
    var minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    lugares.forEach(function (p) {
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    });

    var ancho = (maxLon - minLon + 2 * MARGEN) * ESCALA;
    var alto = (maxLat - minLat + 2 * MARGEN) * FACTOR_LAT * ESCALA;
    var partes = lugares.map(function (p, i) {
      var x = (p.lon - minLon + MARGEN) * ESCALA;
      var y = (maxLat - p.lat + MARGEN) * FACTOR_LAT * ESCALA;
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="1.9" data-i="' + i + '"/>';
    });

    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + ancho.toFixed(1) + " " + alto.toFixed(1));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Mapa de El Salvador dibujado con " + cifra(lugares.length) + " negocios. Cada punto es un negocio. La lista de abajo tiene los mismos nombres.");
    svg.innerHTML = partes.join("");

    var tip = document.createElement("div");
    tip.className = "mapa-tip";
    tip.setAttribute("aria-hidden", "true");

    cont.innerHTML = "";
    cont.classList.add("mapa");
    cont.appendChild(svg);
    cont.appendChild(tip);

    var circulos = Array.prototype.slice.call(svg.getElementsByTagName("circle"));
    var activo = -1;

    function ocultar() {
      if (activo >= 0) circulos[activo].classList.remove("activo");
      activo = -1;
      tip.classList.remove("visible");
    }

    function mostrar(i) {
      if (i === activo) return;
      ocultar();
      activo = i;
      var c = circulos[i];
      c.classList.add("activo");
      var p = lugares[i];
      tip.textContent = "";
      var nombre = document.createElement("strong");
      nombre.textContent = p.nombre;
      var tipo = document.createElement("span");
      tipo.textContent = ETIQUETAS[p.categoria] || "Otros";
      tip.appendChild(nombre);
      tip.appendChild(document.createElement("br"));
      tip.appendChild(tipo);

      var r = c.getBoundingClientRect();
      var R = cont.getBoundingClientRect();
      var x = r.left - R.left + r.width / 2;
      var y = r.top - R.top;
      var f = x / R.width;
      var quitar = "calc(-100% - 12px)";
      tip.style.left = x + "px";
      tip.style.top = y + "px";
      tip.style.transform = f > 0.6 ? "translate(-100%, " + quitar + ")"
        : f < 0.4 ? "translate(0, " + quitar + ")"
        : "translate(-50%, " + quitar + ")";
      tip.classList.add("visible");
    }

    function indiceDe(target) {
      if (!target || target.tagName !== "circle") return -1;
      return Number(target.getAttribute("data-i"));
    }

    svg.addEventListener("pointerover", function (e) {
      var i = indiceDe(e.target);
      if (e.pointerType === "mouse" && i >= 0) mostrar(i);
    });
    svg.addEventListener("pointerout", function (e) {
      if (e.pointerType === "mouse") ocultar();
    });
    svg.addEventListener("pointerdown", function (e) {
      var i = indiceDe(e.target);
      if (i >= 0) mostrar(i); else ocultar();
    });
    document.addEventListener("pointerdown", function (e) {
      if (!cont.contains(e.target)) ocultar();
    });

    return { mostrar: mostrar, ocultar: ocultar };
  }

  function pintarCategorias(ul, d) {
    ul.textContent = "";
    ORDEN.forEach(function (clave) {
      var n = (d.porCategoria && d.porCategoria[clave]) || 0;
      var li = document.createElement("li");
      var nombre = document.createElement("span");
      nombre.textContent = ETIQUETAS[clave];
      var barra = document.createElement("span");
      barra.className = "cat-barra";
      barra.setAttribute("aria-hidden", "true");
      var relleno = document.createElement("span");
      relleno.style.width = (d.total ? (n / d.total) * 100 : 0).toFixed(2) + "%";
      barra.appendChild(relleno);
      var cuenta = document.createElement("span");
      cuenta.className = "cat-cifra";
      cuenta.textContent = cifra(n);
      li.appendChild(nombre);
      li.appendChild(barra);
      li.appendChild(cuenta);
      ul.appendChild(li);
    });
  }

  function pintarLista(ul, lugares, mapa) {
    ul.textContent = "";
    var orden = lugares.map(function (p, i) { return i; });
    orden.sort(function (a, b) { return lugares[a].nombre.localeCompare(lugares[b].nombre, "es"); });
    orden.forEach(function (i) {
      var p = lugares[i];
      var li = document.createElement("li");
      var nombre = document.createElement("span");
      nombre.className = "lista-nombre";
      nombre.textContent = p.nombre;
      var tipo = document.createElement("span");
      tipo.className = "lista-tipo";
      tipo.textContent = ETIQUETAS[p.categoria] || "Otros";
      li.appendChild(nombre);
      li.appendChild(tipo);
      if (mapa) {
        li.addEventListener("pointerover", function (e) { if (e.pointerType === "mouse") mapa.mostrar(i); });
        li.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") mapa.ocultar(); });
      }
      ul.appendChild(li);
    });
  }

  function render(d) {
    var lugares = d.lugares || [];
    poner("[data-total]", cifra(d.total));
    poner("[data-total-mapa]", cifra(d.totalEnElMapa));
    poner("[data-anio]", String(d.verificadosDesde).split("-")[0]);
    poner("[data-generado]", fechaLarga(d.generado));

    var mapas = [];
    document.querySelectorAll("[data-mapa]").forEach(function (cont) {
      mapas.push(dibujarMapa(cont, lugares));
    });

    var cats = document.querySelector("[data-categorias]");
    if (cats) pintarCategorias(cats, d);

    var lista = document.querySelector("[data-lista]");
    if (lista) pintarLista(lista, lugares, mapas[0]);
  }

  fetch("/datos/negocios.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(render)
    .catch(function () {
      document.querySelectorAll("[data-error]").forEach(function (el) { el.hidden = false; });
    });
})();
