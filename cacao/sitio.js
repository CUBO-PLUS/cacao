(function () {
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var distancia = 10;
  var joined = false;
  var open = 0;
  var door = null;
  var raf = 0;
  var lefts = document.querySelectorAll(".mitad-izq");
  var rights = document.querySelectorAll(".mitad-der");
  var puertas = document.querySelectorAll("[data-door]");
  var salida = document.getElementById("salida");
  var tilt = document.querySelector("[data-tilt]");

  var fondos = {
    media: ["#D9902F", "#2A1912"],
    travel: ["#8C2F2B", "#F5EDE3"],
    market: ["#5E3050", "#F5EDE3"],
    pay: ["#2A1912", "#F5EDE3"],
    ledger: ["#5A3221", "#F5EDE3"]
  };

  function pintar() {
    var abierto = joined ? open : 36;
    var ladoA = door === "A" || door === "media" || door === "travel" || door === "market";
    var ladoB = door === "B" || door === "pay" || door === "ledger";
    var izq = -(abierto || (ladoA ? distancia : 0));
    var der = abierto || (ladoB ? distancia : 0);
    lefts.forEach(function (el) { el.style.transform = "translate(" + izq + "px,0)"; });
    rights.forEach(function (el) { el.style.transform = "translate(" + der + "px,0)"; });
    puertas.forEach(function (el) { el.classList.toggle("activa", el.getAttribute("data-door") === door); });
  }

  function fijar(valor) {
    door = valor;
    pintar();
  }

  pintar();
  window.setTimeout(function () { joined = true; pintar(); }, 700);

  document.querySelectorAll("[data-lado]").forEach(function (panel) {
    panel.addEventListener("mouseenter", function () {
      var lado = panel.getAttribute("data-lado");
      if (lado === "A" && door !== "media" && door !== "travel" && door !== "market") fijar("A");
      if (lado === "B" && door !== "pay" && door !== "ledger") fijar("B");
    });
  });

  puertas.forEach(function (enlace) {
    var nombre = enlace.getAttribute("data-door");
    enlace.addEventListener("mouseenter", function () { fijar(nombre); });
    enlace.addEventListener("focus", function () { fijar(nombre); });
    enlace.addEventListener("click", function (evento) {
      if (evento.defaultPrevented || evento.button !== 0) return;
      if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
      evento.preventDefault();
      var colores = fondos[nombre];
      var x = evento.clientX || window.innerWidth / 2;
      var y = evento.clientY || window.innerHeight / 2;
      var marca = enlace.querySelector(".word");
      salida.style.background = colores[0];
      salida.style.color = colores[1];
      salida.innerHTML = marca ? marca.outerHTML : "";
      salida.style.pointerEvents = "auto";
      salida.animate(
        [{ clipPath: "circle(0px at " + x + "px " + y + "px)" }, { clipPath: "circle(150vmax at " + x + "px " + y + "px)" }],
        { duration: 650, easing: "cubic-bezier(.7,0,.2,1)", fill: "forwards" }
      );
      if (salida.firstChild) {
        salida.firstChild.animate(
          [{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }],
          { duration: 500, delay: 250, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }
        );
      }
      window.setTimeout(function () { window.location.href = enlace.href; }, 820);
    });
  });

  var seccion = document.getElementById("puertas");
  if (seccion) {
    seccion.addEventListener("mouseleave", function () { fijar(null); });
    seccion.addEventListener("focusout", function (evento) {
      if (!seccion.contains(evento.relatedTarget)) fijar(null);
    });
  }

  window.addEventListener("pageshow", function (evento) {
    if (!evento.persisted) return;
    salida.getAnimations().forEach(function (anim) { anim.cancel(); });
    salida.style.pointerEvents = "none";
    salida.style.clipPath = "circle(0px at 50% 50%)";
  });

  if (fine && tilt) {
    window.addEventListener("mousemove", function (evento) {
      var x = evento.clientX / window.innerWidth - 0.5;
      var y = evento.clientY / window.innerHeight - 0.5;
      tilt.style.transform = "translate(" + (x * 24) + "px," + (y * 18) + "px) rotate(" + (x * 14) + "deg)";
    });
  }

  window.addEventListener("scroll", function () {
      if (raf) return;
      raf = window.requestAnimationFrame(function () {
        raf = 0;
        var max = document.documentElement.scrollHeight - window.innerHeight;
        var y = window.scrollY;
        var hero = window.innerHeight * 0.6;
        var p = Math.min(1, y / hero) * (1 - Math.max(0, Math.min(1, (y - (max - hero)) / hero)));
        if (Math.abs(p - open / 14) > 0.01) {
          open = p * 14;
          pintar();
        }
      });
    }, { passive: true });

    var piezas = document.querySelectorAll("[data-reveal]");
    piezas.forEach(function (el) {
      if (el.getBoundingClientRect().top > window.innerHeight) el.style.opacity = "0";
    });
    var aviso = window.setTimeout(function () {
      piezas.forEach(function (el) { el.style.opacity = ""; });
    }, 4000);
    if ("IntersectionObserver" in window) {
      var ojo = new IntersectionObserver(function (entradas) {
        entradas.forEach(function (entrada) {
          if (!entrada.isIntersecting) return;
          var el = entrada.target;
          ojo.unobserve(el);
          el.animate(
            [{ opacity: 0, transform: "translateY(36px)" }, { opacity: 1, transform: "none" }],
            { duration: 800, delay: (Number(el.getAttribute("data-reveal")) || 0) * 90, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }
          );
          el.style.opacity = "";
        });
      }, { threshold: 0.15 });
      piezas.forEach(function (el) { ojo.observe(el); });
      window.addEventListener("pagehide", function () { window.clearTimeout(aviso); ojo.disconnect(); });
    }
})();
