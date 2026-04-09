// ============================================================
//  reservas.js — Lógica del formulario de reservas
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  // ── Persona 2: mostrar/ocultar según N° de huéspedes ──
  const selectHuespedes = document.getElementById('huespedes');
  const persona2Row     = document.getElementById('persona2Row');

  function togglePersona2() {
    if (!selectHuespedes || !persona2Row) return;
    const val = selectHuespedes.value;
    persona2Row.style.display = val === '2' ? '' : 'none';
  }

  if (selectHuespedes) {
    selectHuespedes.addEventListener('change', togglePersona2);
    togglePersona2(); // Estado inicial
  }

  // ── Botón "Reservar" en página detalle: pasa fechas a reservas ──
  const btnDetalle  = document.getElementById('btnReservarDetalle');
  const llegadaDet  = document.getElementById('llegadaDetalle');
  const salidaDet   = document.getElementById('salidaDetalle');
  const huespDet    = document.getElementById('huespedesDetalle');

  if (btnDetalle && llegadaDet && salidaDet) {
    btnDetalle.addEventListener('click', (e) => {
      const url = new URL(btnDetalle.href, window.location.origin);
      if (llegadaDet.value) url.searchParams.set('llegada', llegadaDet.value);
      if (salidaDet.value)  url.searchParams.set('salida',  salidaDet.value);
      if (huespDet && huespDet.value) url.searchParams.set('huespedes', huespDet.value);
      window.location.href = url.toString();
      e.preventDefault();
    });
  }

  // ── Autorellenar campos desde URL params ──────────────
  const params = new URLSearchParams(window.location.search);

  const llegadaInput    = document.getElementById('llegada');
  const salidaInput     = document.getElementById('salida');
  const huespedesInput  = document.getElementById('huespedes');

  if (params.get('llegada')   && llegadaInput)   llegadaInput.value   = params.get('llegada');
  if (params.get('salida')    && salidaInput)    salidaInput.value    = params.get('salida');
  if (params.get('huespedes') && huespedesInput) huespedesInput.value = params.get('huespedes');

  // Seleccionar habitación desde param
  const habParam = params.get('habitacion');
  if (habParam) {
    document.querySelectorAll('input[name="habitacion"]').forEach(radio => {
      if (radio.value === habParam) radio.checked = true;
    });
  }

  // Re-evaluar persona 2 después de autorellenar
  if (selectHuespedes) togglePersona2();

});
