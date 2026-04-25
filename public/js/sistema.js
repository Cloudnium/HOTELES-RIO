// ============================================================
//  sistema.js — Sistema de Gestión Interna Hoteles Rio v5
// ============================================================
//  Desarrollado por Cloudnium
const SUPABASE_URL      = 'https://xeuugehcomgmkczzheno.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhldXVnZWhjb21nbWtjenpoZW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MTU5NjgsImV4cCI6MjA5MjA5MTk2OH0.9wJFk8s5cBjNBIXhZnzCXm9Sqz2qziWRdBLiNey3lZU';

const { createClient } = supabase;
// persistSession:true garantiza que la sesión sobrevive cambios de pestaña/ventana
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

let currentUser        = null;
let currentUserProfile = null;
let cajaActual         = null;
let carritoPublico     = {};
let stockOp            = '+';

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  setDateBadge();
  setupLoginForm();
  setupNavigation();
  setupModals();
  setupModalUsuario();
  setupModalProducto();

  // Intentar recuperar sesión guardada
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await handleLogin(session.user);
  }

  // Escuchar cambios: SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT
  sb.auth.onAuthStateChange(async (event, session) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
      if (!currentUser) await handleLogin(session.user);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null; currentUserProfile = null; cajaActual = null;
      showLogin();
    }
  });
});

// Peru = UTC-5 fijo (sin horario de verano)
function fechaPeruHoy() {
  const now = new Date();
  const local = new Date(now.getTime() + (-5*60 - now.getTimezoneOffset()) * 60000);
  return local.toISOString().substring(0, 10);
}
function peruDesdeTS(fecha) {
  return fecha + 'T00:00:00-05:00';
}
function peruHastaTS(fecha) {
  return fecha + 'T23:59:59-05:00';
}
function ahoraPeruISO() {
  const now = new Date();
  return new Date(now.getTime() + (-5*60 - now.getTimezoneOffset()) * 60000).toISOString();
}
function setDateBadge() {
  const hoy = fechaPeruHoy();
  const el = document.getElementById('sys-date-badge');
  if (el) el.textContent = new Date(hoy+'T12:00:00').toLocaleDateString('es-PE',
    { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const cf = document.getElementById('caja-fecha');
  if (cf) cf.textContent = new Date(hoy+'T12:00:00').toLocaleDateString('es-PE');
}

// ══════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════
function setupLoginForm() {
  const btn    = document.getElementById('login-btn');
  const emailIn= document.getElementById('login-email');
  const passIn = document.getElementById('login-pass');
  btn?.addEventListener('click', async () => {
    const email = emailIn.value.trim(), pass = passIn.value;
    if (!email||!pass) { showLoginError('Completa todos los campos'); return; }
    btn.disabled=true;
    document.getElementById('login-btn-text').style.display='none';
    document.getElementById('login-spinner').style.display='block';
    const { error } = await sb.auth.signInWithPassword({ email, password:pass });
    if (error) {
      showLoginError('Credenciales incorrectas.');
      btn.disabled=false;
      document.getElementById('login-btn-text').style.display='block';
      document.getElementById('login-spinner').style.display='none';
    }
  });
  passIn?.addEventListener('keydown', e => { if(e.key==='Enter') btn?.click(); });
}

function showLoginError(msg) {
  const el=document.getElementById('login-error');
  if(el){el.textContent=msg;el.style.display='block';}
}

async function handleLogin(user) {
  currentUser = user;
  let { data: profile } = await sb.from('usuarios').select('*').eq('auth_id', user.id).single();
  if (!profile) {
    const { data:p } = await sb.from('usuarios').insert({
      auth_id:user.id, email:user.email,
      nombre:user.user_metadata?.nombre||user.email.split('@')[0],
      rol:user.user_metadata?.rol||'recepcionista'
    }).select().single();
    profile = p;
  }
  currentUserProfile = profile;

  const name = profile?.nombre||user.email.split('@')[0];
  const role = profile?.rol||'recepcionista';
  document.getElementById('sys-user-name').textContent  = name;
  document.getElementById('sys-user-role').textContent  = rolLabel(role);
  document.getElementById('sys-avatar').textContent     = name.charAt(0).toUpperCase();

  if (role==='limpieza') {
    document.querySelectorAll('.sys-nav-item').forEach(item => {
      if(item.dataset.sec!=='habitaciones') item.style.display='none';
    });
  }
  if (role!=='admin') {
    document.querySelectorAll('[data-sec="usuarios"]').forEach(el=>el.style.display='none');
  }

  // Recuperar caja activa del usuario
  await recuperarCajaActiva();

  actualizarCajaStatus();
  showDashboard();
  loadSection('habitaciones');
  initNotificaciones();
  // Verificar stock bajo al entrar al sistema
  setTimeout(checkStockAlert, 1200);
}

// Recuperar caja activa persistida
async function recuperarCajaActiva() {
  // Buscar caja abierta del usuario SIN filtrar por fecha
  // Así el cajero de turno noche sigue con su caja aunque sea otro día
  const { data:cajas } = await sb.from('cajas')
    .select('*').eq('estado', 'abierta')
    .eq('usuario_id', currentUserProfile.id)
    .order('created_at', {ascending: false})
    .limit(1);
  cajaActual = cajas?.[0] || null;
}

function actualizarCajaStatus() {
  const el = document.getElementById('caja-status-topbar');
  const txt = document.getElementById('caja-status-text');
  if (!el || !txt) return;
  if (cajaActual) {
    el.className = 'caja-status-topbar abierta';
    txt.textContent = `Caja abierta`;
  } else {
    el.className = 'caja-status-topbar cerrada';
    txt.textContent = 'Sin caja abierta';
  }
}

function rolLabel(r){ return {admin:'Administrador',recepcionista:'Recepcionista',cajero:'Cajero',limpieza:'Limpieza'}[r]||r; }

document.getElementById('sys-logout')?.addEventListener('click', async () => {
  await sb.auth.signOut();
});

function showLogin() {
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('dashboard').style.display='none';
}
function showDashboard() {
  document.getElementById('login-screen').style.display='none';
  document.getElementById('dashboard').style.display='flex';
}

// ══════════════════════════════════════════════════════════
//  GUARD: requiere caja abierta
// ══════════════════════════════════════════════════════════
function requireCaja(accion) {
  if (cajaActual) return true;
  showToast(`⚠️ Debes abrir tu caja antes de ${accion}. Ve a Finanzas → Cajas del Día.`, 'err');
  return false;
}

// ══════════════════════════════════════════════════════════
//  NAVEGACIÓN
// ══════════════════════════════════════════════════════════
function setupNavigation() {
  document.querySelectorAll('.sys-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const sec=item.dataset.sec; if(!sec) return;
      document.querySelectorAll('.sys-nav-item').forEach(i=>i.classList.remove('active'));
      item.classList.add('active');
      loadSection(sec);
      document.getElementById('sys-sidebar')?.classList.remove('open');
    });
  });
  document.getElementById('sys-menu-toggle')?.addEventListener('click', () => {
    document.getElementById('sys-sidebar')?.classList.toggle('open');
  });
}

const sectionTitles = {
  habitaciones:'Habitaciones','reservas-web':'Reservas Web',
  'tienda-hab':'Tienda por Habitación','tienda-publica':'Tienda Pública',
  almacen:'Almacén',cajas:'Cajas del Día',egresos:'Egresos',reportes:'Reportes',
  comprobantes:'Comprobantes',clientes:'Clientes',
  comentarios:'Comentarios Web',usuarios:'Usuarios'
};

function loadSection(sec) {
  document.querySelectorAll('.sys-section').forEach(s=>s.classList.remove('active'));
  const el=document.getElementById(`sec-${sec}`);
  if(el) el.classList.add('active');
  document.getElementById('sys-section-title').textContent=sectionTitles[sec]||sec;
  const loaders={
    habitaciones:loadHabitaciones,'reservas-web':loadReservasWeb,
    'tienda-hab':loadTiendaHab,'tienda-publica':loadTiendaPublica,
    almacen:loadAlmacen,cajas:loadCajas,egresos:loadEgresos,reportes:initReportes,
    comprobantes:loadComprobantes,clientes:loadClientes,
    comentarios:loadComentarios,usuarios:loadUsuarios
  };
  loaders[sec]?.();
}

// ══════════════════════════════════════════════════════════
//  SERIE CORRELATIVA  T001-XXXXXXXX / T002-XXXXXXXX / T003-XXXXXXXX
// ══════════════════════════════════════════════════════════
async function getSiguienteSerie(tipo) {
  const prefix = { HAB:'T001', PUB:'T002', CAJA:'T003' }[tipo] || 'T001';
  const { count } = await sb.from('comprobantes')
    .select('*', { count:'exact', head:true }).eq('tipo_serie', tipo);
  return `${prefix}-${String((count||0)+1).padStart(8,'0')}`;
}

async function registrarComprobante({ serie, tipo, descripcion, cliente, total, metodo_pago, datos_json, check_in_id, venta_publica_id }) {
  await sb.from('comprobantes').insert({
    serie, tipo_serie:tipo, descripcion, cliente,
    total, metodo_pago, datos_json:JSON.stringify(datos_json||{}),
    check_in_id, venta_publica_id,
    usuario_id:currentUserProfile?.id,
    caja_id:cajaActual?.id,
  });
}

// ══════════════════════════════════════════════════════════
//  HABITACIONES — agrupadas por categoría
// ══════════════════════════════════════════════════════════
let _timerInterval = null;

function actualizarTimers() {
  document.querySelectorAll('[data-checkin-inicio]').forEach(el => {
    const inicio = new Date(el.dataset.checkinInicio);
    if(isNaN(inicio)) return;
    const diffMs = Date.now() - inicio.getTime();
    const totalSeg = Math.floor(diffMs / 1000);
    const h = Math.floor(totalSeg / 3600);
    const m = Math.floor((totalSeg % 3600) / 60);
    const s = totalSeg % 60;
    const txt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    el.textContent = `⏱ ${txt}`;
    el.className = 'room-timer ' + (h < 3 ? 'ok' : h < 4 ? 'warning' : 'exceeded');
  });
}

async function loadHabitaciones() {
  let query = sb.from('habitaciones').select('*').order('numero');
  const estado = document.getElementById('filter-estado')?.value;
  if(estado) query = query.eq('estado', estado);
  const { data:rooms } = await query;

  // Fetch active check-in timestamps for occupied rooms
  if (rooms?.length) {
    const ocupadasIds = rooms.filter(r=>r.estado==='ocupado').map(r=>r.id);
    if (ocupadasIds.length) {
      const { data:cis } = await sb.from('check_ins')
        .select('habitacion_id, created_at, check_in_fecha')
        .in('habitacion_id', ocupadasIds)
        .is('check_out_real', null);
      cis?.forEach(ci => {
        const rm = rooms.find(r=>r.id===ci.habitacion_id);
        if (rm) rm._checkin_ts = ci.created_at || (ci.check_in_fecha + 'T00:00:00Z');
      });
    }
  }

  renderRoomsGrid(rooms||[]);

  // Start/restart timer interval
  if (_timerInterval) clearInterval(_timerInterval);
  _timerInterval = setInterval(actualizarTimers, 1000);
  actualizarTimers();

  const fe=document.getElementById('filter-estado');
  if(fe&&!fe._bound){fe._bound=true;fe.addEventListener('change',loadHabitaciones);}
  const fp=document.getElementById('filter-piso');
  if(fp) fp.style.display='none';
  // Admin button
  const adminBtn = document.getElementById('btn-nueva-hab-admin');
  if(adminBtn) adminBtn.style.display = currentUserProfile?.rol==='admin' ? 'inline-flex' : 'none';
}

const CATEGORIAS_ORDEN = ['economico','premium','suite'];
const CATEGORIA_LABELS = { economico:'Económico', premium:'Premium', suite:'Suite' };
const CATEGORIA_COLORS = { economico:'#2563eb', premium:'#7c3aed', suite:'#b45309' };

function renderRoomsGrid(rooms) {
  const grid=document.getElementById('rooms-grid');
  if(!grid) return;
  if(!rooms.length){grid.innerHTML='<p style="color:var(--text-light);padding:20px">No hay habitaciones.</p>';return;}

  // Agrupar por categoría
  const grupos = {};
  CATEGORIAS_ORDEN.forEach(c => grupos[c]=[]);
  rooms.forEach(r => {
    const cat = (r.categoria||'economico').toLowerCase();
    if(!grupos[cat]) grupos[cat]=[];
    grupos[cat].push(r);
  });

  let html = '';
  CATEGORIAS_ORDEN.forEach(cat => {
    const lista = grupos[cat];
    if(!lista||!lista.length) return;
    const color = CATEGORIA_COLORS[cat];
    html += `
      <div class="cat-group">
        <div class="cat-group-header" style="border-left-color:${color}">
          <span class="cat-group-label" style="color:${color}">${CATEGORIA_LABELS[cat]||cat}</span>
          <span class="cat-group-count">${lista.length} habitacion${lista.length!==1?'es':''}</span>
        </div>
        <div class="cat-rooms-grid">
          ${lista.map(r=>`
            <div class="room-card-sys status-${r.estado || 'disponible'}" onclick="openRoomModal(${r.id})">
              <div class="room-card-top">
                <div>
                  <div class="room-card-num">NRO: ${String(r.numero).padStart(3,'0')}</div>
                  <div class="room-card-cat">S/. ${r.precio_noche||0} x 4 horas</div>
                </div>
                <div class="room-card-icon">${roomIcon(r.estado)}</div>
              </div>
              ${r.estado==='ocupado' && r._checkin_ts ? `<div class="room-timer ok" data-checkin-inicio="${r._checkin_ts}">⏱ 00:00:00</div>` : ''}
              <div class="room-card-status status-${r.estado||'disponible'}">
                <span>${(r.estado||'DISPONIBLE').toUpperCase()}</span>
                <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  });
  grid.innerHTML = html;
}

function roomIcon(e){
  return {
    disponible:'<i class="fas fa-bed"></i>',
    ocupado:'<i class="fas fa-user-lock"></i>',
    limpieza:'<i class="fas fa-broom"></i>',
    mantenimiento:'<i class="fas fa-tools"></i>',
    reservado:'<i class="fas fa-calendar-check"></i>'
  }[e] || '<i class="fas fa-bed"></i>';
}

async function openRoomModal(id) {
  const { data:room } = await sb.from('habitaciones').select('*').eq('id',id).single();
  if(!room) return;
  const { data:checkins } = await sb.from('check_ins')
    .select('*, clientes(nombre)').eq('habitacion_id',id).is('check_out_real',null);
  const checkinActivo = checkins?.[0];
  document.getElementById('modal-hab-title').textContent=
    `Habitación ${String(room.numero).padStart(3,'0')} — ${CATEGORIA_LABELS[room.categoria]||room.categoria}`;
  const info=document.getElementById('modal-hab-info');
  const actions=document.getElementById('modal-hab-actions');
  info.innerHTML=`
    <h2>Habitación ${String(room.numero).padStart(3,'0')}</h2>
    <div class="modal-info-row"><span>Estado</span><span><span class="badge badge-${badgeColor(room.estado)}">${room.estado}</span></span></div>
    <div class="modal-info-row"><span>Categoría</span><span>${CATEGORIA_LABELS[room.categoria]||room.categoria}</span></div>
    <div class="modal-info-row"><span>Precio/4 horas</span><span>S/. ${room.precio_noche||'—'}</span></div>
    ${checkinActivo?`
      <div class="modal-info-row"><span>Huésped</span><span>${checkinActivo.clientes?.nombre||checkinActivo.nombre_huesped}</span></div>
      <div class="modal-info-row"><span>Check-in</span><span>${formatDate(checkinActivo.check_in_fecha)}</span></div>
      <div class="modal-info-row"><span>Salida est.</span><span>${formatDate(checkinActivo.check_out_estimado)}</span></div>
    `:''}`;
  actions.innerHTML='';

  if(room.estado==='disponible'||room.estado==='reservado') {
    addBtn(actions,'✅ Check-in','sys-btn-gold',()=>{
      if(!requireCaja('hacer check-in')) return;
      openCheckinModal(room); closeModal('modal-habitacion');
    });
  }
  if(room.estado==='ocupado'&&checkinActivo) {
    addBtn(actions,'🚪 Check-out','sys-btn-red',()=>{
      if(!requireCaja('hacer check-out')) return;
      openCheckoutModal(room,checkinActivo); closeModal('modal-habitacion');
    });
  }

  // Estados permitidos según rol:
  // Admin: todos. Otros: limpieza, disponible, mantenimiento, reservado (NO ocupado sin checkin)
  const isAdmin = currentUserProfile?.rol === 'admin';
  const estadosPermitidos = isAdmin
    ? ['disponible','ocupado','limpieza','mantenimiento','reservado']
    : ['disponible','limpieza','mantenimiento','reservado'];
  const estadosCambiables = estadosPermitidos.filter(e=>e!==room.estado);

  if (estadosCambiables.length > 0) {
    const ss=document.createElement('select'); ss.className='sys-select';
    ss.innerHTML=`<option value="">Cambiar estado...</option>`+estadosCambiables.map(e=>`<option value="${e}">${e}</option>`).join('');
    ss.addEventListener('change',async()=>{
      if(!ss.value) return;
      await sb.from('habitaciones').update({estado:ss.value}).eq('id',id);
      showToast('Estado actualizado','ok'); closeModal('modal-habitacion'); loadHabitaciones();
    });
    actions.appendChild(ss);
  }
  // Solo admin puede editar y eliminar habitaciones
  if(isAdmin){
    addBtn(actions,'✏️ Editar','sys-btn-outline',()=>{closeModal('modal-habitacion');editarHabitacion(id);});
    addBtn(actions,'🗑 Eliminar','sys-btn-red sys-btn-sm',()=>{closeModal('modal-habitacion');eliminarHabitacion(id);});
  }
  openModal('modal-habitacion');
}

function addBtn(c,t,cls,fn){const b=document.createElement('button');b.className=`sys-btn ${cls}`;b.innerHTML=t;b.addEventListener('click',fn);c.appendChild(b);}
function badgeColor(e){return{disponible:'verde',ocupado:'rojo',limpieza:'celeste',mantenimiento:'amarillo',reservado:'naranja'}[e]||'gold';}

// ── CHECK-IN ───────────────────────────────────────────────
function openCheckinModal(room) {
  document.getElementById('ci-hab-num').textContent=String(room.numero).padStart(3,'0');
  document.getElementById('ci-precio').value=room.precio_noche||'';
  const today = fechaPeruHoy();
  const mananaDate = new Date(today + 'T12:00:00');
  mananaDate.setDate(mananaDate.getDate()+1);
  const manana = mananaDate.toISOString().split('T')[0];
  document.getElementById('ci-entrada').value=today;
  document.getElementById('ci-salida').value=manana;
  // Valores por defecto para clientes rápidos
  const nombreEl = document.getElementById('ci-nombre');
  const dniEl    = document.getElementById('ci-dni');
  const telEl    = document.getElementById('ci-tel');
  if(nombreEl && !nombreEl.value) nombreEl.value = 'CLIENTE GENERAL';
  if(dniEl    && !dniEl.value)    dniEl.value    = '00000000';
  if(telEl    && !telEl.value)    telEl.value    = '000000000';
  document.getElementById('btn-confirmar-checkin').onclick=()=>confirmarCheckin(room.id);
  openModal('modal-checkin');
}
async function confirmarCheckin(habId) {
  if(!requireCaja('hacer check-in')) return;
  const nombre=document.getElementById('ci-nombre').value.trim();
  const dni   =document.getElementById('ci-dni').value.trim();
  if(!nombre||!dni){showToast('Nombre y DNI son obligatorios','err');return;}
  let clienteId=null;
  const { data:ce } = await sb.from('clientes').select('id').eq('dni',dni).maybeSingle();
  if(ce){clienteId=ce.id;}
  else{
    const { data:nc } = await sb.from('clientes').insert({
      nombre,dni,telefono:document.getElementById('ci-tel').value,email:document.getElementById('ci-email').value
    }).select('id').single();
    clienteId=nc?.id;
  }
  await sb.from('check_ins').insert({
    habitacion_id:habId,cliente_id:clienteId,nombre_huesped:nombre,dni_huesped:dni,
    check_in_fecha:document.getElementById('ci-entrada').value,
    check_out_estimado:document.getElementById('ci-salida').value,
    num_huespedes:parseInt(document.getElementById('ci-huespedes').value)||1,
    precio_noche:parseFloat(document.getElementById('ci-precio').value)||0,
    observaciones:document.getElementById('ci-obs').value,
    usuario_id:currentUserProfile?.id,caja_id:cajaActual?.id,
  });
  await sb.from('habitaciones').update({estado:'ocupado'}).eq('id',habId);
  showToast('✅ Check-in registrado','ok');
  closeModal('modal-checkin'); loadHabitaciones();
}

// ── CHECK-OUT ──────────────────────────────────────────────
async function openCheckoutModal(room, checkin) {
  if(!requireCaja('hacer check-out')) return;
  document.getElementById('co-hab-num').textContent = String(room.numero).padStart(3,'0');

  // Precio FIJO — se cobra una vez independiente de las horas
  const totalHab = checkin.precio_noche || 0;

  const { data:consumos } = await sb.from('consumos_habitacion')
    .select('*, productos(nombre)').eq('check_in_id', checkin.id).is('cobrado', false);
  const totalConsumos = consumos?.reduce((s,c)=>s+(c.precio_total||0),0) || 0;
  const totalBase = totalHab + totalConsumos;

  // Calcular tiempo transcurrido
  const ciTS = checkin.created_at || (checkin.check_in_fecha + 'T00:00:00');
  const horasUsadas = (Date.now() - new Date(ciTS).getTime()) / 3600000;
  const excedido = horasUsadas > 4;

  const summary = document.getElementById('checkout-summary');
  summary.innerHTML = `
    <div class="checkout-row"><span>Huésped</span><span><strong>${checkin.nombre_huesped}</strong></span></div>
    <div class="checkout-row"><span>DNI</span><span>${checkin.dni_huesped||'—'}</span></div>
    <div class="checkout-row"><span>Tiempo usado</span>
      <span>${horasUsadas.toFixed(1)}h de 4h${excedido ? ` <span style="color:var(--danger);font-weight:700">(+${(horasUsadas-4).toFixed(1)}h extra)</span>` : ''}</span>
    </div>
    <div class="checkout-row"><span>Precio habitación</span><span>S/. ${totalHab.toFixed(2)}</span></div>
    ${consumos?.map(c=>`<div class="checkout-row"><span>&nbsp;• ${c.productos?.nombre||'—'} x${c.cantidad}</span><span>S/. ${(c.precio_total||0).toFixed(2)}</span></div>`).join('')||''}
    ${totalConsumos>0?`<div class="checkout-row"><span>Consumos extras</span><span>S/. ${totalConsumos.toFixed(2)}</span></div>`:''}
    ${excedido?`
    <div class="co-sancion-box">
      <div style="color:var(--warning);font-weight:600;margin-bottom:6px">⚠️ Tiempo excedido — Sanción (opcional):</div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:13px">S/.</span>
        <input type="number" id="monto-sancion" class="sys-input" placeholder="0.00"
          step="0.01" min="0" style="width:110px;text-align:right"
          oninput="window._coRecalc()">
        <span style="font-size:12px;color:var(--text-2)">ingresa 0 si no aplica</span>
      </div>
    </div>`:''}
    <div class="co-extra-box">
      <div class="co-extra-row">
        <span style="color:#16a34a;font-weight:600">🏷️ Descuento (opcional, S/.)</span>
        <input type="number" id="monto-descuento" class="sys-input" placeholder="0.00"
          step="0.01" min="0" style="width:110px;text-align:right"
          oninput="window._coRecalc()">
      </div>
      <div class="co-extra-row">
        <span style="color:#dc2626;font-weight:600">⚠️ Multa por daños (opcional, S/.)</span>
        <input type="number" id="monto-multa" class="sys-input" placeholder="0.00"
          step="0.01" min="0" style="width:110px;text-align:right"
          oninput="window._coRecalc()">
      </div>
    </div>
    <div class="checkout-row checkout-total">
      <span>TOTAL A COBRAR</span><span id="co-total-display">S/. ${totalBase.toFixed(2)}</span>
    </div>
    <div class="pago-section">
      <div class="form-field"><label>Método de pago</label>
        <div class="metodo-pago-grid">
          <button class="metodo-btn active" data-metodo="Efectivo">💵 Efectivo</button>
          <button class="metodo-btn" data-metodo="Tarjeta">💳 Tarjeta</button>
          <button class="metodo-btn" data-metodo="Yape">📱 Yape</button>
          <button class="metodo-btn" data-metodo="Plin">📱 Plin</button>
        </div>
      </div>
      <div id="efectivo-section" class="efectivo-section">
        <div class="form-field"><label>Efectivo recibido (S/.)</label>
          <input type="number" id="efectivo-recibido" class="sys-input" step="0.01"
            value="${totalBase.toFixed(2)}">
        </div>
        <div class="vuelto-display">Vuelto: <strong id="vuelto-display">S/. 0.00</strong></div>
      </div>
    </div>`;

  // Recalcular total cuando cambia la sanción
  window._coBase = totalBase;
  window._coMetodo = 'Efectivo';
  window._coRecalc = function() {
    const san  = parseFloat(document.getElementById('monto-sancion')?.value||0)||0;
    const desc = parseFloat(document.getElementById('monto-descuento')?.value||0)||0;
    const mult = parseFloat(document.getElementById('monto-multa')?.value||0)||0;
    const nv = Math.max(0, window._coBase + san - desc + mult);
    document.getElementById('co-total-display').textContent = `S/. ${nv.toFixed(2)}`;
    document.getElementById('efectivo-recibido').value = nv.toFixed(2);
    document.getElementById('vuelto-display').textContent = 'S/. 0.00';
  };

  summary.querySelectorAll('.metodo-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      summary.querySelectorAll('.metodo-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      window._coMetodo = btn.dataset.metodo;
      document.getElementById('efectivo-section').style.display = btn.dataset.metodo==='Efectivo'?'block':'none';
    });
  });

  document.getElementById('efectivo-recibido')?.addEventListener('input',e=>{
    const san = parseFloat(document.getElementById('monto-sancion')?.value||0)||0;
    const tot = window._coBase + san;
    const v = Math.max(0, parseFloat(e.target.value||0)-tot);
    const vd = document.getElementById('vuelto-display');
    vd.textContent=`S/. ${v.toFixed(2)}`; vd.style.color=v>0?'var(--primary)':'var(--text-2)';
  });

  // Confirmar checkout
  document.getElementById('btn-confirmar-checkout').onclick = async() => {
    const metP = window._coMetodo || 'Efectivo';
    const san  = parseFloat(document.getElementById('monto-sancion')?.value||0)||0;
    const desc = parseFloat(document.getElementById('monto-descuento')?.value||0)||0;
    const mult = parseFloat(document.getElementById('monto-multa')?.value||0)||0;
    const tot  = Math.max(0, window._coBase + san - desc + mult);
    const rec  = parseFloat(document.getElementById('efectivo-recibido')?.value)||tot;
    const vuel = metP==='Efectivo' ? Math.max(0,rec-tot) : 0;
    await confirmarCheckout(room, checkin, tot, consumos, metP, vuel, totalHab, totalConsumos, san, desc, mult);
  };

  openModal('modal-checkout');
}

// Las penalizaciones ya se manejan dentro del modal — estas funciones siguen existiendo
// por si el modal de penalizacion externo se llama desde otro lugar
async function continuarCheckoutSinPen(){
  closeModal('modal-penalizacion');
  const d=window._checkoutData;
  if(d) await confirmarCheckout(d.room,d.checkin,d.totalBase,d.consumos,window._coMetodo||'Efectivo',0,d.totalHab,d.totalConsumos,0);
}
async function continuarCheckoutConPen(){
  const pen=parseFloat(document.getElementById('penalizacion-monto')?.value)||0;
  closeModal('modal-penalizacion');
  const d=window._checkoutData;
  if(d) await confirmarCheckout(d.room,d.checkin,d.totalBase+pen,d.consumos,window._coMetodo||'Efectivo',0,d.totalHab,d.totalConsumos,pen);
}

async function confirmarCheckout(room, checkin, total, consumos, metodoPago, vuelto, totalHab, totalConsumos, penalizacion=0, descuento=0, multa=0) {
  try {
    // 1. Cerrar modal PRIMERO para que el usuario vea que algo pasó
    closeModal('modal-checkout');
    showToast('Procesando check-out...','ok');

    // 2. Actualizar BD
    await sb.from('check_ins').update({
      check_out_real: new Date().toISOString(),
      total_cobrado: total,
      metodo_pago: metodoPago
    }).eq('id', checkin.id);

    await sb.from('habitaciones').update({estado:'limpieza'}).eq('id', room.id);

    if(consumos?.length)
      await sb.from('consumos_habitacion').update({cobrado:true}).in('id',consumos.map(c=>c.id));

    if(cajaActual?.id) {
      await sb.from('movimientos_caja').insert({
        caja_id: cajaActual.id,
        concepto: `Check-out Hab.${String(room.numero).padStart(3,'0')} (${metodoPago})` +
                  (penalizacion>0?` | Sanción S/.${penalizacion.toFixed(2)}`:''),
        tipo: 'ingreso',
        monto: total,
        usuario_id: currentUserProfile?.id,
      });
    }

    // 3. Generar serie y comprobante
    const serie = await getSiguienteSerie('HAB');
    const datosTicket = {
      serie, room, checkin, consumos, total, metodoPago, vuelto,
      totalHab, totalConsumos, penalizacion, descuento, multa,
      cajero: currentUserProfile?.nombre||'—',
      fecha:  new Date().toISOString()
    };

    await registrarComprobante({
      serie, tipo:'HAB',
      descripcion: `Hab.${String(room.numero).padStart(3,'0')} — ${CATEGORIA_LABELS[room.categoria]||room.categoria}`,
      cliente: checkin.nombre_huesped,
      total, metodo_pago: metodoPago,
      datos_json: datosTicket,
      check_in_id: checkin.id
    });

    // 4. Recargar habitaciones
    loadHabitaciones();
    showToast('🚪 Check-out completado','ok');

    // 5. Abrir ticket (después de un breve delay para no bloquear UI)
    setTimeout(() => imprimirTicketHabitacion(datosTicket), 400);

  } catch(err) {
    console.error('Error en checkout:', err);
    showToast('Error al procesar: ' + (err.message||'ver consola'), 'err');
  }
}

//  TICKETS IMPRESIÓN TÉRMICA 80mm
// ══════════════════════════════════════════════════════════
function abrirVentanaTicket(html) {
  const win=window.open('','_blank','width=420,height=740');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Ticket</title>
    <style>
      @page{size:80mm auto;margin:4mm}
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Courier New',Courier,monospace;font-size:11px;width:72mm;color:#000;background:#fff}
      .c{text-align:center}.b{font-weight:bold}.big{font-size:14px}.sm{font-size:9px}
      .ln{border-top:1px dashed #000;margin:4px 0}
      .logo{width:55mm;max-height:22mm;object-fit:contain;display:block;margin:0 auto 4px}
      table{width:100%;border-collapse:collapse}
      td{padding:1px 0;vertical-align:top}
      td.r{text-align:right;white-space:nowrap}
      .tr-total td{border-top:1px dashed #000;font-weight:bold;padding-top:3px}
      .hab-num{font-size:26px;font-weight:bold;text-align:center;letter-spacing:3px;margin:4px 0}
      .hab-cat{font-size:9px;text-align:center;letter-spacing:1px;text-transform:uppercase}
      .serie{font-size:10px;font-weight:bold;text-align:center;letter-spacing:1px;margin:3px 0}
      @media print{button{display:none!important}}
    </style>
  </head><body>
    ${html}
    <div style="text-align:center;margin-top:10px">
      <button onclick="window.print()" style="padding:8px 22px;font-size:13px;cursor:pointer;background:#1a1a1a;color:#fff;border:none;border-radius:4px;font-family:sans-serif">🖨 Imprimir</button>
    </div>
  </body></html>`);
  win.document.close();
}

function cabecera(serie) {
  const now=new Date();
  return `
    <div class="c">
      <img src="/images/logos/logo.png" class="logo" onerror="this.style.display='none'">
      <div class="b big">HOTELES RIO</div>
      <div class="sm">Au. Panamericana N 915, Sullana 20103</div>
      <div class="sm">Tel: +51 951-149-420</div>
    </div>
    <div class="ln"></div>
    <div class="c b">NOTA DE VENTA</div>
    <div class="serie">${serie}</div>
    <div class="ln"></div>
    <table>
      <tr><td>F. Emisión:</td><td class="r">${now.toLocaleDateString('es-PE')} ${now.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}</td></tr>
      <tr><td>F. Vencimiento:</td><td class="r">${now.toLocaleDateString('es-PE')}</td></tr>
    </table>
    <div class="ln"></div>`;
}

function imprimirTicketHabitacion(d) {
  const consumosHTML=d.consumos?.length
    ?`<div class="ln"></div><div class="b sm">Consumos:</div><table>${d.consumos.map(c=>`<tr><td>${c.productos?.nombre||'—'}</td><td class="r">x${c.cantidad}</td><td class="r">S/.${c.precio_total?.toFixed(2)}</td></tr>`).join('')}</table>`:''
  const pagoHTML=d.metodoPago==='Efectivo'
    ?`<tr><td>Efectivo recibido:</td><td class="r">S/. ${(d.total+d.vuelto).toFixed(2)}</td></tr><tr><td>Vuelto:</td><td class="r">S/. ${d.vuelto.toFixed(2)}</td></tr>`:''
  abrirVentanaTicket(`
    ${cabecera(d.serie)}
    <div><span class="b">Cliente:</span> ${d.checkin.nombre_huesped}</div>
    <div><span class="b">DNI:</span> ${d.checkin.dni_huesped||'—'}</div>
    <div class="ln"></div>
    <table>
      <tr><td>Habitación (tarifa fija)</td><td class="r">S/.${d.totalHab.toFixed(2)}</td></tr>
      ${(d.penalizacion||0)>0?`<tr><td>Sanción por tiempo extra</td><td class="r">+S/.${(d.penalizacion||0).toFixed(2)}</td></tr>`:''}
      ${(d.descuento||0)>0?`<tr><td>Descuento aplicado</td><td class="r" style="color:#16a34a">-S/.${(d.descuento||0).toFixed(2)}</td></tr>`:''}
      ${(d.multa||0)>0?`<tr><td>Multa por daños</td><td class="r" style="color:#dc2626">+S/.${(d.multa||0).toFixed(2)}</td></tr>`:''}
    </table>
    ${consumosHTML}
    <div class="ln"></div>
    <table><tr class="tr-total"><td class="b">TOTAL A PAGAR:</td><td class="r b">S/. ${d.total.toFixed(2)}</td></tr></table>
    <div class="ln"></div>
    <table>
      <tr><td>Método de pago:</td><td class="r">${d.metodoPago}</td></tr>
      ${pagoHTML}
    </table>
    <div class="ln"></div>
    <div class="hab-num">${String(d.room.numero).padStart(3,'0')}</div>
    <div class="hab-cat">${(CATEGORIA_LABELS[d.room.categoria]||d.room.categoria||'').toUpperCase()}</div>
    <div class="ln"></div>
    <div class="c sm">Cajero: ${d.cajero}</div>
    <div class="c sm">¡Gracias por su visita! — Hoteles Rio</div>
    <br><br>`);
}

function imprimirTicketTienda(d) {
  const pagoHTML=d.metodoPago==='Efectivo'
    ?`<tr><td>Efectivo recibido:</td><td class="r">S/. ${(d.total+d.vuelto).toFixed(2)}</td></tr><tr><td>Vuelto:</td><td class="r">S/. ${d.vuelto.toFixed(2)}</td></tr>`:''
  abrirVentanaTicket(`
    ${cabecera(d.serie)}
    <div class="c b">VENTA AL PÚBLICO</div>
    <div class="ln"></div>
    <div><span class="b">Cajero:</span> ${d.cajero}</div>
    ${d.caja?`<div><span class="b">Caja:</span> ${d.caja}</div>`:''}
    <div class="ln"></div>
    <table>
      <tr><td class="b">Descripción</td><td class="r b">Cant.</td><td class="r b">Total</td></tr>
      ${d.items.map(([,i])=>`<tr><td>${i.nombre}</td><td class="r">x${i.cantidad}</td><td class="r">S/.${(i.precio*i.cantidad).toFixed(2)}</td></tr>`).join('')}
      <tr class="tr-total"><td colspan="2" class="b">TOTAL:</td><td class="r b">S/. ${d.total.toFixed(2)}</td></tr>
    </table>
    <div class="ln"></div>
    <table>
      <tr><td>Método de pago:</td><td class="r">${d.metodoPago}</td></tr>
      ${pagoHTML}
    </table>
    <div class="ln"></div>
    <div class="c sm">¡Gracias por su compra! — Hoteles Rio</div>
    <br><br>`);
}

function imprimirTicketCaja(d) {
  // d: { serie, caja, usuario, fecha, movimientos, resumenMetodos, totalGeneral }
  const filasMov = d.movimientos.slice(0,30).map(m=>
    `<tr><td class="sm">${formatTime(m.created_at)}</td><td class="sm">${m.concepto?.substring(0,20)}</td><td class="r sm">${m.tipo==='ingreso'?'+':'-'}${m.monto?.toFixed(2)}</td></tr>`
  ).join('');
  const filasMetodos = Object.entries(d.resumenMetodos).map(([met,monto])=>
    `<tr><td>${met}</td><td class="r b">S/. ${monto.toFixed(2)}</td></tr>`
  ).join('');
  abrirVentanaTicket(`
    <div class="c">
      <img src="/images/logos/logo.png" class="logo" onerror="this.style.display='none'">
      <div class="b big">HOTELES RIO</div>
    </div>
    <div class="ln"></div>
    <div class="c b">RESUMEN DE CAJA</div>
    <div class="serie">${d.serie}</div>
    <div class="ln"></div>
    <table>
      <tr><td class="b">Caja:</td><td class="r">${d.caja}</td></tr>
      <tr><td class="b">Usuario:</td><td class="r">${d.usuario}</td></tr>
      <tr><td class="b">Fecha apertura:</td><td class="r">${d.fecha}</td></tr>
      <tr><td class="b">Hora apertura:</td><td class="r">${d.horaApertura}</td></tr>
      ${d.horaCierre?`<tr><td class="b">Hora cierre:</td><td class="r">${d.horaCierre}</td></tr>`:''}
      <tr><td class="b">Estado:</td><td class="r">${d.estado}</td></tr>
    </table>
    <div class="ln"></div>
    <div class="b sm">INGRESOS POR MÉTODO DE PAGO:</div>
    <table>${filasMetodos}</table>
    <div class="ln"></div>
    <table>
      <tr class="tr-total"><td class="b">TOTAL INGRESOS:</td><td class="r b">S/. ${d.totalGeneral.toFixed(2)}</td></tr>
      ${d.totalEgresos>0?`<tr><td style="color:#dc2626">(-) Egresos del día:</td><td class="r" style="color:#dc2626">S/. ${d.totalEgresos.toFixed(2)}</td></tr>`:''}
      ${d.totalEgresos>0?`<tr class="tr-total"><td class="b">NETO:</td><td class="r b">S/. ${(d.totalGeneral-d.totalEgresos).toFixed(2)}</td></tr>`:''}
    </table>
    <div class="ln"></div>
    <div class="b sm">DETALLE DE MOVIMIENTOS (${d.movimientos.length}):</div>
    <table>${filasMov}</table>
    ${d.movimientos.length>30?`<div class="c sm">... y ${d.movimientos.length-30} más</div>`:''}
    <div class="ln"></div>
    <div class="c sm">Impreso: ${new Date().toLocaleString('es-PE')}</div>
    <br><br>`);
}

function reimprimirComprobante(comp) {
  try {
    const d=typeof comp.datos_json==='string'?JSON.parse(comp.datos_json):comp.datos_json;
    if(comp.tipo_serie==='HAB') imprimirTicketHabitacion(d);
    else if(comp.tipo_serie==='PUB') imprimirTicketTienda(d);
    else if(comp.tipo_serie==='CAJA') imprimirTicketCaja(d);
  } catch(e){ showToast('No se puede reimprimir','err'); }
}

// ══════════════════════════════════════════════════════════
//  TIENDA POR HABITACIÓN
// ══════════════════════════════════════════════════════════
async function loadTiendaHab() {
  if(!requireCaja('vender productos')) return;
  const { data:ocupadas } = await sb.from('habitaciones').select('numero,id').eq('estado','ocupado').order('numero');
  const ids=ocupadas?.map(h=>h.id)||[];
  let checkinMap={};
  if(ids.length){
    const { data:cis } = await sb.from('check_ins').select('habitacion_id,id,nombre_huesped').in('habitacion_id',ids).is('check_out_real',null);
    cis?.forEach(c=>{checkinMap[c.habitacion_id]=c;});
  }
  const sel=document.getElementById('sel-hab-tienda');
  if(sel){
    sel.innerHTML='<option value="">Seleccionar habitación ocupada...</option>'+(ocupadas||[]).map(h=>{
      const ci=checkinMap[h.id];
      return `<option value="${h.id}" data-checkin="${ci?.id||''}">${String(h.numero).padStart(3,'0')} — ${ci?.nombre_huesped||'Huésped'}</option>`;
    }).join('');
    if(!sel._bound){sel._bound=true;sel.addEventListener('change',loadConsumosHab);}
  }
  loadProductsQuick('products-quick',false);
}
async function loadConsumosHab() {
  const sel=document.getElementById('sel-hab-tienda');
  const checkinId=sel?.options[sel.selectedIndex]?.dataset.checkin;
  if(!checkinId) return;
  const { data:consumos } = await sb.from('consumos_habitacion')
    .select('*, productos(nombre,precio_venta)').eq('check_in_id',checkinId).is('cobrado',false)
    .order('created_at',{ascending:false});
  const tbody=document.getElementById('consumos-hab-list');
  const total=consumos?.reduce((s,c)=>s+(c.precio_total||0),0)||0;
  tbody.innerHTML=consumos?.length
    ?consumos.map(c=>`<tr><td>${c.productos?.nombre||'—'}</td><td>${c.cantidad}</td><td>S/. ${c.precio_unitario?.toFixed(2)}</td><td>S/. ${c.precio_total?.toFixed(2)}</td><td>${formatTime(c.created_at)}</td><td><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="eliminarConsumo(${c.id})">✕</button></td></tr>`).join('')
    :'<tr><td colspan="6" class="empty-row">Sin consumos</td></tr>';
  document.getElementById('total-consumos-hab').textContent=`S/. ${total.toFixed(2)}`;
}
async function agregarConsumoHab(productoId,nombre,precio) {
  if(!requireCaja('agregar consumos')) return;
  const sel=document.getElementById('sel-hab-tienda');
  const checkinId=sel?.options[sel.selectedIndex]?.dataset.checkin;
  if(!checkinId){showToast('Selecciona una habitación primero','err');return;}
  await sb.from('consumos_habitacion').insert({check_in_id:checkinId,producto_id:productoId,cantidad:1,precio_unitario:precio,precio_total:precio,usuario_id:currentUserProfile?.id});
  await sb.rpc('descontar_stock',{p_producto_id:productoId,p_cantidad:1});
  showToast(`+1 ${nombre}`,'ok'); loadConsumosHab();
}
async function eliminarConsumo(id){
  await sb.from('consumos_habitacion').delete().eq('id',id);
  showToast('Eliminado','ok'); loadConsumosHab();
}

// ══════════════════════════════════════════════════════════
//  TIENDA PÚBLICA — Catálogo + Carrito
// ══════════════════════════════════════════════════════════
async function loadTiendaPublica() {
  if(!requireCaja('vender en tienda')) return;
  carritoPublico={};
  await cargarCatalogoPub();
  await loadVentasHoy();
  renderCarrito();

  const inp=document.getElementById('search-product-pub');
  const catSel=document.getElementById('filter-cat-pub');
  const filtrar=()=>{
    const q=(inp?.value||'').toLowerCase();
    const cat=catSel?.value||'';
    document.querySelectorAll('#products-catalog .prod-card').forEach(card=>{
      const name=card.dataset.name||'';
      const cardCat=card.dataset.cat||'';
      const matchQ=!q||name.includes(q);
      const matchC=!cat||cardCat===cat;
      card.style.display=(matchQ&&matchC)?'':'none';
    });
  };
  if(inp&&!inp._bound){inp._bound=true;inp.addEventListener('input',filtrar);}
  if(catSel&&!catSel._bound){catSel._bound=true;catSel.addEventListener('change',filtrar);}

  const btnN=document.getElementById('btn-nueva-venta-pub');
  if(btnN){btnN.onclick=()=>limpiarCarrito();}
  const btnLimpiar=document.getElementById('btn-limpiar-carrito');
  if(btnLimpiar){btnLimpiar.onclick=()=>limpiarCarrito();}
  const btnConf=document.getElementById('btn-confirmar-venta-pub');
  if(btnConf){btnConf.onclick=abrirModalPagoPub;}
}

function limpiarCarrito(){
  carritoPublico={};
  document.querySelectorAll('#products-catalog .prod-card').forEach(c=>{
    c.classList.remove('in-cart');
    const badge=c.querySelector('.prod-qty-badge');
    if(badge) badge.textContent='0';
  });
  renderCarrito();
}

async function cargarCatalogoPub(){
  const { data:prods } = await sb.from('productos').select('*').eq('activo',true).order('nombre');
  const container=document.getElementById('products-catalog'); if(!container) return;
  const EMOJIS={bebidas:'🥤',snacks:'🍿',higiene:'🧴',servicios:'🛎️',otros:'📦'};
  container.innerHTML=prods?.length
    ?prods.map(p=>`
        <div class="prod-card ${p.stock<=0?'no-stock':''}"
             data-name="${escStr((p.nombre||'').toLowerCase())}" data-cat="${p.categoria||''}"
             onclick="${p.stock>0?`addToCarritoPub(${p.id},'${escStr(p.nombre)}',${p.precio_venta})`:''}">
          <span class="prod-emoji">${EMOJIS[p.categoria]||'📦'}</span>
          <div class="prod-name">${p.nombre}</div>
          <div class="prod-price">S/. ${p.precio_venta?.toFixed(2)}</div>
          <div class="prod-stock">${p.stock<=0?'Sin stock':'Stock: '+p.stock}</div>
          <div class="prod-qty-badge" id="badge-${p.id}">0</div>
        </div>`).join('')
    :'<p style="padding:20px;color:var(--text-3)">No hay productos en almacén.</p>';
  // Inicializar contador
  const hoyCount=document.getElementById('ventas-hoy-count');
  if(hoyCount){
    const hoy=new Date().toISOString().split('T')[0];
    const { count } = await sb.from('ventas_publicas').select('*',{count:'exact',head:true}).gte('created_at',hoy+'T00:00:00');
    hoyCount.textContent=`${count||0} venta${(count||0)!==1?'s':''} hoy`;
  }
}

function addToCarritoPub(prodId,nombre,precio){
  if(!requireCaja('vender')) return;
  if(!carritoPublico[prodId]) carritoPublico[prodId]={nombre,precio,cantidad:0};
  carritoPublico[prodId].cantidad++;
  const badge=document.getElementById(`badge-${prodId}`);
  if(badge) badge.textContent=carritoPublico[prodId].cantidad;
  const card=badge?.closest('.prod-card');
  if(card) card.classList.add('in-cart');
  renderCarrito();
}

function addToCarritoPublico(prodId,nombre,precio){ addToCarritoPub(prodId,nombre,precio); }

function cambiarCantidad(prodId,delta){
  if(!carritoPublico[prodId]) return;
  carritoPublico[prodId].cantidad=Math.max(0,carritoPublico[prodId].cantidad+delta);
  const badge=document.getElementById(`badge-${prodId}`);
  if(badge) badge.textContent=carritoPublico[prodId].cantidad;
  const card=badge?.closest('.prod-card');
  if(carritoPublico[prodId].cantidad===0){
    delete carritoPublico[prodId];
    if(card) card.classList.remove('in-cart');
  } else if(card) card.classList.add('in-cart');
  renderCarrito();
}

function renderCarrito(){
  const items=Object.entries(carritoPublico).filter(([,i])=>i.cantidad>0);
  const total=items.reduce((s,[,i])=>s+i.precio*i.cantidad,0);
  const count=items.reduce((s,[,i])=>s+i.cantidad,0);

  const cBadge=document.getElementById('carrito-count');
  if(cBadge) cBadge.textContent=count;
  const cTotal=document.getElementById('carrito-total');
  if(cTotal) cTotal.textContent=`S/. ${total.toFixed(2)}`;

  const cItems=document.getElementById('carrito-items'); if(!cItems) return;
  if(!items.length){
    cItems.innerHTML=`<div class="carrito-empty"><i class="fas fa-shopping-basket"></i><p style="font-size:13px;font-weight:500;color:var(--text-2)">Carrito vacío</p><p style="font-size:11px;color:var(--text-3);margin-top:4px">Haz clic en un producto</p></div>`;
    return;
  }
  cItems.innerHTML=items.map(([id,i])=>`
    <div class="carrito-item">
      <div class="carrito-item-info">
        <div class="carrito-item-name">${i.nombre}</div>
        <div class="carrito-item-price">S/. ${i.precio.toFixed(2)} c/u — <strong>S/. ${(i.precio*i.cantidad).toFixed(2)}</strong></div>
      </div>
      <div class="carrito-item-controls">
        <button class="qty-btn" onclick="cambiarCantidad(${id},-1)">−</button>
        <span class="qty-num">${i.cantidad}</span>
        <button class="qty-btn" onclick="cambiarCantidad(${id},+1)">+</button>
      </div>
    </div>`).join('');
}

async function loadVentasHoy() {
  const hoy=fechaPeruHoy();
  const { data:ventas } = await sb.from('ventas_publicas').select('*, usuarios(nombre)').gte('created_at',hoy+'T00:00:00').order('created_at',{ascending:false});
  const tbody=document.getElementById('ventas-pub-list'); if(!tbody) return;
  tbody.innerHTML=ventas?.length?ventas.map(v=>`<tr><td>${formatTime(v.created_at)}</td><td>${v.detalle||'—'}</td><td>S/. ${v.total?.toFixed(2)}</td><td>${v.usuarios?.nombre||'—'}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-row">Sin ventas hoy</td></tr>';
}

function renderTotalPublico(){
  const total=Object.values(carritoPublico).reduce((s,i)=>s+i.precio*i.cantidad,0);
  const el=document.getElementById('total-pub-display'); if(el) el.textContent=`S/. ${total.toFixed(2)}`;
}
function abrirModalPagoPub(){
  if(!requireCaja('confirmar venta')) return;
  const items=Object.entries(carritoPublico).filter(([,i])=>i.cantidad>0);
  if(!items.length){showToast('Agrega productos al carrito primero','err');return;}
  const total=items.reduce((s,[,i])=>s+i.precio*i.cantidad,0);
  const modal=document.getElementById('modal-pago-pub'); if(!modal) return;
  document.getElementById('pago-pub-items').innerHTML=
    items.map(([,i])=>`<div class="checkout-row"><span>${i.nombre} x${i.cantidad}</span><span>S/. ${(i.precio*i.cantidad).toFixed(2)}</span></div>`).join('')+
    `<div class="checkout-row checkout-total"><span>TOTAL</span><span>S/. ${total.toFixed(2)}</span></div>`;
  let metodoPub='Efectivo';
  modal.querySelectorAll('.metodo-btn').forEach(btn=>{
    btn.classList.remove('active');
    if(btn.dataset.metodo==='Efectivo') btn.classList.add('active');
    btn.onclick=()=>{modal.querySelectorAll('.metodo-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');metodoPub=btn.dataset.metodo;document.getElementById('efectivo-pub-section').style.display=metodoPub==='Efectivo'?'block':'none';};
  });
  const ef=document.getElementById('efectivo-pub-recibido');
  if(ef){ef.value=total.toFixed(2);ef.oninput=()=>{const v=Math.max(0,parseFloat(ef.value||0)-total);document.getElementById('vuelto-pub').textContent=`S/. ${v.toFixed(2)}`;};}
  document.getElementById('btn-confirmar-pago-pub').onclick=async()=>{
    const recibido=parseFloat(document.getElementById('efectivo-pub-recibido')?.value)||total;
    const vuelto=metodoPub==='Efectivo'?Math.max(0,recibido-total):0;
    await procesarVentaPublica(items,total,metodoPub,vuelto);
    closeModal('modal-pago-pub');
  };
  openModal('modal-pago-pub');
}
async function procesarVentaPublica(items,total,metodoPago,vuelto){
  const detalle=items.map(([,i])=>`${i.cantidad}x ${i.nombre}`).join(', ');
  const lineas=items.map(([,i])=>({nombre:i.nombre,cantidad:i.cantidad,precio_unit:i.precio,subtotal:i.precio*i.cantidad}));
  for(const [prodId,info] of items) await sb.rpc('descontar_stock',{p_producto_id:parseInt(prodId),p_cantidad:info.cantidad});
  const { data:venta } = await sb.from('ventas_publicas').insert({total,detalle,metodo_pago:metodoPago,lineas_json:JSON.stringify(lineas),usuario_id:currentUserProfile?.id,caja_id:cajaActual?.id}).select().single();
  await sb.from('movimientos_caja').insert({caja_id:cajaActual.id,concepto:`Venta pública: ${detalle}`,tipo:'ingreso',monto:total,usuario_id:currentUserProfile?.id});
  const serie=await getSiguienteSerie('PUB');
  const cajero=currentUserProfile?.nombre||'—';
  const cajaNombre=`Caja #${cajaActual.id}`;
  const datosTicket={serie,items,total,metodoPago,vuelto,cajero,caja:cajaNombre,fecha:new Date().toISOString()};
  await registrarComprobante({serie,tipo:'PUB',descripcion:detalle,cliente:'Cliente General',total,metodo_pago:metodoPago,datos_json:datosTicket,venta_publica_id:venta?.id});
  imprimirTicketTienda(datosTicket);
  carritoPublico={}; renderCarrito(); document.querySelectorAll('[id^="badge-"]').forEach(el=>{el.textContent='0';}); document.querySelectorAll('.prod-card').forEach(c=>c.classList.remove('in-cart'));
  showToast(`✅ Venta S/. ${total.toFixed(2)} registrada`,'ok'); await loadVentasHoy();
}

async function loadProductsQuick(containerId,isPublic=false){
  const { data:prods } = await sb.from('productos').select('*').eq('activo',true).order('nombre');
  const container=document.getElementById(containerId); if(!container) return;
  container.innerHTML=prods?.length
    ?prods.map(p=>`
        <div class="product-quick-card ${p.stock<=0?'no-stock':''}"
             onclick="${p.stock>0?(isPublic?`addToCarritoPublico(${p.id},'${escStr(p.nombre)}',${p.precio_venta})`:`agregarConsumoHab(${p.id},'${escStr(p.nombre)}',${p.precio_venta})`):''}">
          <div class="pq-name">${p.nombre}</div>
          <div class="pq-price">S/. ${p.precio_venta?.toFixed(2)}</div>
          <div class="pq-stock">Stock: ${p.stock}</div>
          ${isPublic?`<div class="pq-carrito" id="carrito-${p.id}"></div>`:''}
        </div>`).join('')
    :'<p style="padding:16px;color:var(--text-light)">No hay productos.</p>';
}

// ══════════════════════════════════════════════════════════
//  ALMACÉN
// ══════════════════════════════════════════════════════════
async function loadAlmacen(){
  const { data:prods } = await sb.from('productos').select('*').order('nombre');
  const sinStock=prods?.filter(p=>p.stock<=0).length||0;
  const stockBajo=prods?.filter(p=>p.stock>0&&p.stock<=(p.stock_minimo||5)).length||0;
  document.getElementById('almacen-stats').innerHTML=`
    <div class="stat-card-sys"><p>Total productos</p><h3>${prods?.length||0}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#dc2626"><p>Sin stock</p><h3>${sinStock}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#ca8a04"><p>Stock bajo</p><h3>${stockBajo}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#16a34a"><p>Activos</p><h3>${prods?.filter(p=>p.activo).length||0}</h3></div>`;
  document.getElementById('products-table').innerHTML=prods?.length
    ?prods.map(p=>`<tr>
        <td>${p.codigo||'—'}</td><td><strong>${p.nombre}</strong></td><td>${p.categoria||'—'}</td>
        <td>S/. ${p.precio_venta?.toFixed(2)||'0.00'}</td><td><strong>${p.stock}</strong></td><td>${p.stock_minimo||5}</td>
        <td><span class="badge ${p.stock<=0?'badge-rojo':p.stock<=(p.stock_minimo||5)?'badge-amarillo':'badge-verde'}">${p.stock<=0?'Sin stock':p.stock<=(p.stock_minimo||5)?'Stock bajo':'OK'}</span></td>
        <td>${currentUserProfile?.rol==='admin'?`
          <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editProduct(${p.id})">Editar</button>
          <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="toggleProduct(${p.id},${!p.activo})">${p.activo?'Desact.':'Activar'}</button>`
          :'<span style="font-size:11px;color:var(--text-3)">Solo admin</span>'}
        </td></tr>`).join('')
    :'<tr><td colspan="8" class="empty-row">No hay productos</td></tr>';
  const btnAdd=document.getElementById('btn-add-product');
  if(btnAdd){
    if(currentUserProfile?.rol!=='admin') btnAdd.style.display='none';
    else btnAdd.onclick=()=>{
    document.getElementById('prod-id').value='';
    document.getElementById('modal-prod-title').textContent='Nuevo producto';
    ['prod-nombre','prod-codigo','prod-precio-venta','prod-stock','prod-stock-min'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    document.getElementById('stock-edit-section').style.display='none';
    document.getElementById('stock-nuevo-section').style.display='block';
    document.getElementById('prod-stock-ajuste').value='0';
    document.getElementById('stock-resultado-preview').textContent='';
    openModal('modal-producto');
  };
  }
}
async function editProduct(id){
  const { data:p } = await sb.from('productos').select('*').eq('id',id).single();
  document.getElementById('prod-id').value=id;
  document.getElementById('modal-prod-title').textContent='Editar producto';
  document.getElementById('prod-nombre').value=p.nombre||'';
  document.getElementById('prod-codigo').value=p.codigo||'';
  document.getElementById('prod-categoria').value=p.categoria||'otros';
  document.getElementById('prod-precio-venta').value=p.precio_venta||'';
  document.getElementById('prod-stock-min').value=p.stock_minimo||5;
  document.getElementById('stock-edit-section').style.display='block';
  document.getElementById('stock-nuevo-section').style.display='none';
  document.getElementById('prod-stock-actual').textContent=p.stock;
  document.getElementById('prod-stock-ajuste').value='0';
  stockOp='+';
  const btnS=document.getElementById('btn-stock-sumar');const btnR=document.getElementById('btn-stock-restar');
  if(btnS) btnS.style.cssText='background:var(--gold);color:var(--charcoal)';
  if(btnR) btnR.style.cssText='';
  actualizarPreviewStock(p.stock);
  openModal('modal-producto');
}
function actualizarPreviewStock(stockActual){
  const ajuste=parseInt(document.getElementById('prod-stock-ajuste')?.value)||0;
  const nuevo=stockOp==='+'?stockActual+ajuste:Math.max(0,stockActual-ajuste);
  const prev=document.getElementById('stock-resultado-preview');
  if(prev) prev.textContent=ajuste>0?`Stock resultante: ${nuevo} unidades`:'';
}
function setupModalProducto(){
  const btnS=document.getElementById('btn-stock-sumar');
  const btnR=document.getElementById('btn-stock-restar');
  const inp=document.getElementById('prod-stock-ajuste');
  btnS?.addEventListener('click',()=>{stockOp='+';btnS.style.cssText='background:var(--gold);color:var(--charcoal)';btnR.style.cssText='';actualizarPreviewStock(parseInt(document.getElementById('prod-stock-actual')?.textContent)||0);});
  btnR?.addEventListener('click',()=>{stockOp='-';btnR.style.cssText='background:#dc2626;color:#fff';btnS.style.cssText='';actualizarPreviewStock(parseInt(document.getElementById('prod-stock-actual')?.textContent)||0);});
  inp?.addEventListener('input',()=>actualizarPreviewStock(parseInt(document.getElementById('prod-stock-actual')?.textContent)||0));
  document.getElementById('btn-guardar-producto')?.addEventListener('click',async()=>{
    const id=document.getElementById('prod-id').value;
    const nombre=document.getElementById('prod-nombre').value.trim();
    if(!nombre){showToast('El nombre es obligatorio','err');return;}
    const data={nombre,codigo:document.getElementById('prod-codigo').value.trim(),categoria:document.getElementById('prod-categoria').value,precio_venta:parseFloat(document.getElementById('prod-precio-venta').value)||0,stock_minimo:parseInt(document.getElementById('prod-stock-min').value)||5,activo:true};
    if(id){
      const { data:pA } = await sb.from('productos').select('stock').eq('id',id).single();
      const sA=pA?.stock||0;const aj=parseInt(inp.value)||0;
      data.stock=stockOp==='+'?sA+aj:Math.max(0,sA-aj);
      await sb.from('productos').update(data).eq('id',id);
    } else {
      data.stock=parseInt(document.getElementById('prod-stock').value)||0;
      await sb.from('productos').insert(data);
    }
    showToast('Producto guardado ✓','ok'); closeModal('modal-producto'); loadAlmacen();
  });
}
async function toggleProduct(id,estado){await sb.from('productos').update({activo:estado}).eq('id',id);showToast('Actualizado','ok');loadAlmacen();}

// ══════════════════════════════════════════════════════════
//  CAJAS — con histórico por fecha y ticket de cierre
// ══════════════════════════════════════════════════════════
async function loadCajas(){
  const hoy = fechaPeruHoy(); // ← siempre UTC-5 Perú, nunca new Date() directo
  // Input fecha: sin restricciones, permite fechas anteriores
  const fecInput = document.getElementById('caja-hist-fecha');
  if(fecInput) {
    fecInput.removeAttribute('min');   // ← quitar bloqueo de días pasados
    fecInput.removeAttribute('max');   // ← quitar bloqueo de días futuros
    if(!fecInput.value) fecInput.value = hoy;
  }
  const fechaFiltro = fecInput?.value || hoy;
  document.getElementById('caja-fecha').textContent = fechaFiltro;

  // Buscar por fecha de APERTURA (campo 'fecha') — muestra aunque hayan
  // cerrado al día siguiente (turno noche)
  const { data:cajas } = await sb.from('cajas').select('*, usuarios(nombre)').eq('fecha',fechaFiltro).order('created_at');

  // Comparar siempre con fechaPeruHoy() evaluado en el momento (no la variable capturada)
  if(fechaFiltro === fechaPeruHoy()) cajaActual=cajas?.find(c=>c.usuario_id===currentUserProfile?.id&&c.estado==='abierta')||cajaActual||null;

  const grid=document.getElementById('cajas-grid');
  grid.innerHTML=cajas?.length
    ?cajas.map(c=>`
        <div class="caja-card ${c.estado==='abierta'?'caja-abierta':'caja-cerrada'}">
          <h4>${c.usuarios?.nombre||'—'}</h4>
          <div class="caja-user">📅 Abierta el ${c.fecha} | <span class="badge ${c.estado==='abierta'?'badge-verde':'badge-rojo'}">${c.estado}</span></div>
          <div class="caja-total">S/. ${(c.total||0).toFixed(2)}</div>
          <div class="caja-sub">
            🟢 Apertura: ${formatTime(c.hora_apertura||c.created_at)}
            ${c.hora_cierre?`&nbsp;|&nbsp;🔴 Cierre: ${formatTime(c.hora_cierre)}`:''}
          </div>
          <div class="caja-actions">
            ${c.estado==='abierta'&&c.usuario_id===currentUserProfile?.id
              ?`<button class="sys-btn sys-btn-outline sys-btn-sm" onclick="cerrarCaja(${c.id})">Cerrar caja</button>`:''}
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="abrirDetalleCaja(${c.id})">Ver detalle</button>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="imprimirCaja(${c.id})">🖨 Ticket</button>
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="descargarReporteCaja(${c.id})"><i class="fas fa-download"></i> Descargar</button>
          </div>
        </div>`).join('')
    :'<p style="color:var(--text-light)">No hay cajas en esta fecha.</p>';

  const btnAbrir=document.getElementById('btn-abrir-caja');
  if(btnAbrir) btnAbrir.onclick=abrirCaja;

  // Bind filtro fecha
  if(fecInput&&!fecInput._bound){fecInput._bound=true;fecInput.addEventListener('change',loadCajas);}

  // Mostrar movimientos de la caja activa del usuario (sin importar el día)
  if(cajaActual){
    const { data:movs } = await sb.from('movimientos_caja').select('*').eq('caja_id',cajaActual.id).order('created_at',{ascending:false});
    const tbody=document.getElementById('caja-movimientos');
    tbody.innerHTML=movs?.length
      ?movs.map(m=>`<tr><td>${formatTime(m.created_at)}</td><td>${m.concepto}</td><td><span class="badge ${m.tipo==='ingreso'?'badge-verde':'badge-rojo'}">${m.tipo}</span></td><td>S/. ${m.monto?.toFixed(2)}</td></tr>`).join('')
      :'<tr><td colspan="4" class="empty-row">Sin movimientos</td></tr>';
  }
}

async function verDetalleCaja(cajaId){
  const { data:movs } = await sb.from('movimientos_caja').select('*').eq('caja_id',cajaId).order('created_at',{ascending:false});
  const tbody=document.getElementById('caja-movimientos');
  tbody.innerHTML=movs?.length
    ?movs.map(m=>`<tr><td>${formatTime(m.created_at)}</td><td>${m.concepto}</td><td><span class="badge ${m.tipo==='ingreso'?'badge-verde':'badge-rojo'}">${m.tipo}</span></td><td>S/. ${m.monto?.toFixed(2)}</td></tr>`).join('')
    :'<tr><td colspan="4" class="empty-row">Sin movimientos</td></tr>';
  document.getElementById('caja-movimientos').scrollIntoView({behavior:'smooth'});
}

async function imprimirCaja(cajaId){
  const { data:caja } = await sb.from('cajas').select('*, usuarios(nombre)').eq('id',cajaId).single();
  const { data:movs } = await sb.from('movimientos_caja').select('*').eq('caja_id',cajaId).order('created_at',{ascending:false});

// Calcular resumen por método de pago leyendo de comprobantes
const resumenMetodos = {};
const { data:compHAB } = await sb.from('comprobantes')
  .select('metodo_pago, total')
  .eq('caja_id', cajaId)
  .eq('tipo_serie', 'HAB');
compHAB?.forEach(c => {
  const m = c.metodo_pago || 'Efectivo';
  resumenMetodos[m] = (resumenMetodos[m]||0) + (c.total||0);
});
const { data:compPUB } = await sb.from('comprobantes')
  .select('metodo_pago, total')
  .eq('caja_id', cajaId)
  .eq('tipo_serie', 'PUB');
compPUB?.forEach(v => {
  const m = v.metodo_pago || 'Efectivo';
  resumenMetodos[m] = (resumenMetodos[m]||0) + (v.total||0);
});

  const serie=await getSiguienteSerie('CAJA');
  // Cargar egresos del día para incluir en el ticket
  // Egresos del día — con manejo seguro de error
  let totalEgresos = 0;
  try {
    const { data:egresosTicket } = await sb.from('egresos').select('monto').eq('fecha', caja?.fecha||fechaPeruHoy());
    totalEgresos = (egresosTicket||[]).reduce((s,e)=>s+(e.monto||0), 0);
  } catch(e) { console.warn('No se pudo cargar egresos:', e); }
  const horaApertura = caja?.hora_apertura
    ? new Date(caja.hora_apertura).toLocaleString('es-PE',{hour:'2-digit',minute:'2-digit',hour12:true,day:'2-digit',month:'2-digit',year:'numeric'})
    : formatTime(caja?.created_at);
  const horaCierre = caja?.hora_cierre
    ? new Date(caja.hora_cierre).toLocaleString('es-PE',{hour:'2-digit',minute:'2-digit',hour12:true,day:'2-digit',month:'2-digit',year:'numeric'})
    : null;
  const datosTicket={
    serie, caja:`#${cajaId}`, usuario:caja?.usuarios?.nombre||'—',
    fecha:caja?.fecha, estado:caja?.estado,
    horaApertura, horaCierre,
    movimientos:movs||[], resumenMetodos, totalGeneral:caja?.total||0, totalEgresos
  };
  await registrarComprobante({serie,tipo:'CAJA',descripcion:`Resumen caja #${cajaId}`,cliente:'—',total:caja?.total||0,metodo_pago:'Varios',datos_json:datosTicket});
  imprimirTicketCaja(datosTicket);
}

async function abrirCaja(){
  if(cajaActual){showToast('Ya tienes una caja abierta','err');return;}
  const hoy = fechaPeruHoy(); // fecha en que ABRE (puede ser diferente a cuando cierra)
  const { data } = await sb.from('cajas').insert({
    usuario_id: currentUserProfile?.id,
    fecha: hoy,
    estado: 'abierta',
    total: 0,
    hora_apertura: new Date().toISOString() // timestamp exacto de apertura
  }).select().single();
  cajaActual=data; actualizarCajaStatus(); showToast('✅ Caja abierta','ok'); loadCajas();
}
async function cerrarCaja(id){
  // Guardar hora exacta de cierre — sin importar si ya es otro día (turno noche)
  await sb.from('cajas').update({
    estado: 'cerrada',
    hora_cierre: new Date().toISOString()
  }).eq('id',id);
  if(cajaActual?.id===id) cajaActual=null;
  actualizarCajaStatus(); showToast('Caja cerrada ✓','ok'); loadCajas();
}

// ══════════════════════════════════════════════════════════
//  REPORTES
// ══════════════════════════════════════════════════════════
function initReportes(){
  const hoyStr=fechaPeruHoy();
  const hoyDate=new Date(hoyStr+'T12:00:00');
  const primer=new Date(hoyDate.getFullYear(),hoyDate.getMonth(),1).toISOString().split('T')[0];
  const desdEl=document.getElementById('reporte-desde');
  const hastaEl=document.getElementById('reporte-hasta');
  // Quitar restricciones de calendario
  if(desdEl){ desdEl.removeAttribute('max'); desdEl.removeAttribute('min'); if(!desdEl.value) desdEl.value=primer; }
  if(hastaEl){ hastaEl.removeAttribute('max'); hastaEl.removeAttribute('min'); if(!hastaEl.value) hastaEl.value=hoyStr; }
  // Auto-generar al cambiar fechas
  if(desdEl&&!desdEl._bound){ desdEl._bound=true; desdEl.addEventListener('change',()=>{ if(document.getElementById('reporte-hasta')?.value) generarReporte(); }); }
  if(hastaEl&&!hastaEl._bound){ hastaEl._bound=true; hastaEl.addEventListener('change',()=>{ if(document.getElementById('reporte-desde')?.value) generarReporte(); }); }
  // Pequeño delay para asegurar que la sección esté visible en el DOM
  setTimeout(generarReporte, 50);
}
async function generarReporte(){
  const desde = document.getElementById('reporte-desde')?.value;
  const hasta  = document.getElementById('reporte-hasta')?.value;
  if(!desde||!hasta){ showToast('Selecciona el rango de fechas','err'); return; }
  const desdeTS = peruDesdeTS(desde);
  const hastaTS  = peruHastaTS(hasta);

  // Helper seguro para queries que pueden fallar (tabla no existe, etc)
  async function safeQuery(queryFn) {
    try {
      const result = await queryFn();
      return result.data || [];
    } catch(e) {
      console.warn('Query error:', e);
      return [];
    }
  }

  // Cargar todos los datos — cada uno de forma segura e independiente
  const [checkins, ventasPub, habitaciones, reservasPeriodo, egresosData, consumosHabData] = await Promise.all([
    safeQuery(()=> sb.from('check_ins')
      .select('*, habitaciones(numero,categoria)')
      .gte('check_in_fecha', desde)
      .lte('check_in_fecha', hasta)
      .order('created_at',{ascending:false})),
    safeQuery(()=> sb.from('ventas_publicas')
      .select('*')
      .gte('created_at', desdeTS)
      .lte('created_at', hastaTS)),
    safeQuery(()=> sb.from('habitaciones').select('estado')),
    safeQuery(()=> sb.from('reservas_web')
      .select('id, fecha_reserva, estado')
      .gte('fecha_reserva', desde)
      .lte('fecha_reserva', hasta)
      .order('fecha_reserva', {ascending:false})),
    safeQuery(()=> sb.from('egresos')
      .select('monto')
      .gte('created_at', desdeTS)
      .lte('created_at', hastaTS)),
    safeQuery(()=> sb.from('consumos_habitacion')
      .select('*, productos(nombre)')
      .gte('created_at', desdeTS)
      .lte('created_at', hastaTS)),
  ]);

  // ── KPIs habitaciones (estado actual, no filtrado por fecha) ──
  const totHabs  = habitaciones.length;
  const dispHabs = habitaciones.filter(h=>h.estado==='disponible').length;
  const ocupHabs = habitaciones.filter(h=>h.estado==='ocupado').length;
  const mantHabs = habitaciones.filter(h=>h.estado==='mantenimiento').length;
  const checkoutsPeriodo = checkins.filter(c=>c.check_out_real).length;
  const reservasCnt = reservasPeriodo.length;
  console.log('DEBUG reportes:', {checkins: checkins.length, ventasPub: ventasPub.length, habitaciones: habitaciones.length, reservasCnt, egresosData: egresosData.length});

  const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  set('rep-tot-habs',           totHabs);
  set('rep-disponibles',        dispHabs);
  set('rep-ocupadas',           ocupHabs);
  set('rep-mant',               mantHabs);
  set('rep-reservas-hoy',       reservasCnt);
  set('rep-checkouts-periodo',  checkoutsPeriodo);

  // ── KPIs financieros ──
  const totalHab    = checkins.reduce((s,c)=>s+(c.total_cobrado||0), 0);
  const totalTienda = ventasPub.reduce((s,v)=>s+(v.total||0), 0);
  const totalGen    = totalHab + totalTienda;
  const totalEgr    = egresosData.reduce((s,e)=>s+(e.monto||0), 0);

  // Resumen por método de pago
  const mMap = {};
  checkins.forEach(c=>{  const m=c.metodo_pago||'Efectivo'; mMap[m]=(mMap[m]||0)+(c.total_cobrado||0); });
  ventasPub.forEach(v=>{ const m=v.metodo_pago||'Efectivo'; mMap[m]=(mMap[m]||0)+(v.total||0); });
  const efectivo = mMap['Efectivo']||0;
  const otros    = (mMap['Tarjeta']||0)+(mMap['Yape']||0)+(mMap['Plin']||0);

  set('rep-total-general',       `S/. ${totalGen.toFixed(2)}`);
  set('rep-efectivo',            `S/. ${efectivo.toFixed(2)}`);
  set('rep-otros',               `S/. ${otros.toFixed(2)}`);
  set('rep-co-completados',      checkoutsPeriodo);
  set('rep-ventas-count',        `${ventasPub.length} VENTAS`);
  set('rep-ventas-sub',          `S/. ${totalTienda.toFixed(2)}`);
  set('rep-egresos-val',         `S/. ${totalEgr.toFixed(2)}`);

  const lbl = document.getElementById('rep-periodo-label');
  if(lbl) lbl.textContent = `Período: ${formatDate(desde)} — ${formatDate(hasta)}`;

  // ── Tabla: ingresos por habitación (agrupado por CATEGORÍA) ──
  const groupHab = {};
  checkins.forEach(c=>{
    const cat   = c.habitaciones?.categoria || 'otros';
    const label = CATEGORIA_LABELS[cat] || cat;
    if(!groupHab[cat]) groupHab[cat]={ cat, label, usos:0, total:0 };
    groupHab[cat].usos++;
    groupHab[cat].total += c.total_cobrado||0;
  });
  const tbHab = document.getElementById('reporte-habitaciones');
  if(tbHab) tbHab.innerHTML = Object.values(groupHab).length
    ? Object.values(groupHab).map(h=>`
        <tr>
          <td><i class="fas fa-bed" style="color:var(--primary);margin-right:6px"></i>
            <span class="badge badge-gold">${h.label}</span>
          </td>
          <td>${h.usos}</td>
          <td><strong>S/. ${h.total.toFixed(2)}</strong></td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="empty-row">Sin check-ins en este período</td></tr>';

  // ── Tabla: ventas tienda pública ──
  const groupPub = {};
  ventasPub.forEach(v=>{
    try {
      const ls = JSON.parse(v.lineas_json||'[]');
      ls.forEach(l=>{
        if(!groupPub[l.nombre]) groupPub[l.nombre]={ nombre:l.nombre, cantidad:0, total:0 };
        groupPub[l.nombre].cantidad += Number(l.cantidad)||0;
        groupPub[l.nombre].total    += Number(l.subtotal)||0;
      });
    } catch(_) {
      if(!groupPub['Varios']) groupPub['Varios']={ nombre:'Varios', cantidad:0, total:0 };
      groupPub['Varios'].cantidad++;
      groupPub['Varios'].total += v.total||0;
    }
  });
  const tbPub = document.getElementById('reporte-ventas');
  if(tbPub) tbPub.innerHTML = Object.values(groupPub).length
    ? Object.values(groupPub).sort((a,b)=>b.total-a.total).map(p=>`
        <tr>
          <td>${p.nombre}</td>
          <td>${p.cantidad}</td>
          <td><strong>S/. ${p.total.toFixed(2)}</strong></td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="empty-row">Sin ventas en tienda pública</td></tr>';

  // ── Combinar productos de tienda pública + tienda x habitación ──
  const groupAll = { ...groupPub }; // copia de tienda pública
  consumosHabData.forEach(c => {
    const nombre = c.productos?.nombre || 'Desconocido';
    if(!groupAll[nombre]) groupAll[nombre] = { nombre, cantidad:0, total:0 };
    groupAll[nombre].cantidad += Number(c.cantidad)||0;
    groupAll[nombre].total    += Number(c.precio_total)||0;
  });

  // ── Top 5 productos — gráfico donut (todas las ventas) ──
  renderTop5(Object.values(groupAll), desde, hasta);

  // ── Top habitaciones más usadas ──
  renderTopHabs(Object.values(groupHab), desde, hasta);

  // ── Tabla: detalle check-outs ──
  const tbCo = document.getElementById('reporte-checkins');
  if(tbCo) tbCo.innerHTML = checkins.length
    ? checkins.map(c=>{
        let pen = 0;
        try { const d=JSON.parse(c.datos_json||'{}'); pen=Number(d.penalizacion)||0; } catch(_){}
        const consumos = Math.max(0,(c.total_cobrado||0)-(c.precio_noche||0)-pen);
        return `<tr>
          <td class="sm">${c.serie_comprobante||'—'}</td>
          <td>Hab. ${String(c.habitaciones?.numero||'?').padStart(3,'0')}</td>
          <td>${c.nombre_huesped||'—'}</td>
          <td>${formatDate(c.check_in_fecha)}</td>
          <td>${c.check_out_real ? formatDate(c.check_out_real) : '<span class="badge badge-verde">Activo</span>'}</td>
          <td>S/. ${(c.precio_noche||0).toFixed(2)}</td>
          <td>S/. ${consumos.toFixed(2)}</td>
          <td>${pen>0?`<span class="badge badge-rojo">S/. ${pen.toFixed(2)}</span>`:'—'}</td>
          <td>${c.metodo_pago||'—'}</td>
          <td><strong>S/. ${(c.total_cobrado||0).toFixed(2)}</strong></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="10" class="empty-row">Sin check-ins en este período</td></tr>';
}


// ══════════════════════════════════════════════════════════
//  COMPROBANTES
// ══════════════════════════════════════════════════════════
async function loadComprobantes(){
  const hoy=new Date().toISOString().split('T')[0];
  const fd=document.getElementById('filter-comp-desde');
  const fh=document.getElementById('filter-comp-hasta');
  if(fd){fd.removeAttribute('max');fd.removeAttribute('min');if(!fd.value)fd.value=hoy;}
  if(fh){fh.removeAttribute('max');fh.removeAttribute('min');if(!fh.value)fh.value=hoy;}
  if(!document.getElementById('btn-filtrar-comp')._bound){
    document.getElementById('btn-filtrar-comp')._bound=true;
    document.getElementById('btn-filtrar-comp').addEventListener('click',filtrarComprobantes);
    document.getElementById('search-comprobante')?.addEventListener('input',filtrarComprobantes);
    document.getElementById('filter-comp-tipo')?.addEventListener('change',filtrarComprobantes);
  }
  await filtrarComprobantes();
}
async function filtrarComprobantes(){
  const desdeFecha = document.getElementById('filter-comp-desde')?.value || fechaPeruHoy();
  const hastaFecha = document.getElementById('filter-comp-hasta')?.value || fechaPeruHoy();
  const desde = peruDesdeTS(desdeFecha);
  const hasta  = peruHastaTS(hastaFecha);
  const tipo=document.getElementById('filter-comp-tipo')?.value||'';
  const q=document.getElementById('search-comprobante')?.value.trim()||'';
  let query=sb.from('comprobantes').select('*, usuarios(nombre)').gte('created_at',desde).lte('created_at',hasta).order('created_at',{ascending:false});
  if(tipo) query=query.eq('tipo_serie',tipo);
  if(q)    query=query.ilike('serie',`%${q}%`);
  const { data:comps } = await query;
  const totalMonto=comps?.reduce((s,c)=>s+(c.total||0),0)||0;
  document.getElementById('comp-stats').innerHTML=`
    <div class="stat-card-sys"><p>Comprobantes emitidos</p><h3>${comps?.length||0}</h3></div>
    <div class="stat-card-sys"><p>Hab. / Check-outs</p><h3>${comps?.filter(c=>c.tipo_serie==='HAB').length||0}</h3></div>
    <div class="stat-card-sys"><p>Tienda pública</p><h3>${comps?.filter(c=>c.tipo_serie==='PUB').length||0}</h3></div>
    <div class="stat-card-sys" style="border-left-color:#16a34a"><p>Total emitido</p><h3>S/. ${totalMonto.toFixed(2)}</h3></div>`;
  document.getElementById('comprobantes-table').innerHTML=comps?.length
    ?comps.map(c=>`<tr>
        <td><span class="badge badge-gold" style="font-size:11px">${c.serie}</span></td>
        <td><span class="badge ${c.tipo_serie==='HAB'?'badge-celeste':c.tipo_serie==='CAJA'?'badge-amarillo':'badge-verde'}">${{HAB:'Habitación',PUB:'Tienda',CAJA:'Caja'}[c.tipo_serie]||c.tipo_serie}</span></td>
        <td>${formatDate(c.created_at)} ${formatTime(c.created_at)}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.cliente||'—'}<br><span style="font-size:10px;color:var(--text-light)">${c.descripcion||''}</span></td>
        <td>${c.metodo_pago||'—'}</td>
        <td><strong>S/. ${c.total?.toFixed(2)}</strong></td>
        <td style="white-space:nowrap">
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="reimprimirComp(${c.id})">🖨 Reimprimir</button>
            ${currentUserProfile?.rol==='admin'?`<button class="sys-btn sys-btn-outline sys-btn-sm" style="margin-left:4px" onclick="editarMetodoPago(${c.id})">✏️ Pago</button>`:''}
            ${currentUserProfile?.rol==='admin'?`<button class="sys-btn sys-btn-red sys-btn-sm" style="margin-left:4px" onclick="eliminarComprobante(${c.id},'${c.tipo_serie}',${c.check_in_id||'null'},${c.total||0})">🗑 Anular</button>`:''}
          </td>
      </tr>`).join('')
    :'<tr><td colspan="7" class="empty-row">No hay comprobantes en este rango</td></tr>';
}
async function reimprimirComp(id){
  const { data:comp } = await sb.from('comprobantes').select('*').eq('id',id).single();
  if(!comp){showToast('Comprobante no encontrado','err');return;}
  reimprimirComprobante(comp);
}

// ══════════════════════════════════════════════════════════
//  CLIENTES
// ══════════════════════════════════════════════════════════
async function loadClientes(){
  const q=document.getElementById('search-cliente')?.value.toLowerCase()||'';
  let query=sb.from('clientes').select('*').order('nombre');
  if(q) query=query.or(`nombre.ilike.%${q}%,dni.ilike.%${q}%`);
  const { data:clientes } = await query;
  document.getElementById('clientes-table').innerHTML=clientes?.length
    ?clientes.map(c=>`<tr><td><strong>${c.nombre}</strong></td><td>${c.dni||'—'}</td><td>${c.telefono||'—'}</td><td>${c.email||'—'}</td><td>${c.ultima_estancia?formatDate(c.ultima_estancia):'—'}</td><td>—</td><td><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editCliente(${c.id})">Editar</button></td></tr>`).join('')
    :'<tr><td colspan="7" class="empty-row">Sin clientes</td></tr>';
  const inp=document.getElementById('search-cliente');
  if(inp&&!inp._bound){inp._bound=true;inp.addEventListener('input',loadClientes);}
  const btnAdd=document.getElementById('btn-add-cliente');
  if(btnAdd) btnAdd.onclick=()=>{document.getElementById('cli-id').value='';document.getElementById('modal-cli-title').textContent='Nuevo cliente';['cli-nombre','cli-dni','cli-tel','cli-email','cli-obs'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});openModal('modal-cliente');};
}
async function editCliente(id){
  const { data:c } = await sb.from('clientes').select('*').eq('id',id).single();
  document.getElementById('cli-id').value=id;document.getElementById('modal-cli-title').textContent='Editar cliente';
  document.getElementById('cli-nombre').value=c.nombre||'';document.getElementById('cli-dni').value=c.dni||'';document.getElementById('cli-tel').value=c.telefono||'';document.getElementById('cli-email').value=c.email||'';document.getElementById('cli-obs').value=c.observaciones||'';
  openModal('modal-cliente');
}
document.getElementById('btn-guardar-cliente')?.addEventListener('click',async()=>{
  const id=document.getElementById('cli-id').value;
  const data={nombre:document.getElementById('cli-nombre').value.trim(),dni:document.getElementById('cli-dni').value.trim(),telefono:document.getElementById('cli-tel').value.trim(),email:document.getElementById('cli-email').value.trim(),observaciones:document.getElementById('cli-obs').value.trim()};
  if(!data.nombre){showToast('Nombre obligatorio','err');return;}
  if(id) await sb.from('clientes').update(data).eq('id',id); else await sb.from('clientes').insert(data);
  showToast('Cliente guardado ✓','ok');closeModal('modal-cliente');loadClientes();
});

// ══════════════════════════════════════════════════════════
//  USUARIOS
// ══════════════════════════════════════════════════════════
async function loadUsuarios(){
  const { data:users } = await sb.from('usuarios').select('*').order('nombre');
  document.getElementById('users-table').innerHTML=users?.length
    ?users.map(u=>`<tr><td><strong>${u.nombre}</strong></td><td>${u.email||'—'}</td><td><span class="badge badge-gold">${rolLabel(u.rol)}</span></td><td><span class="badge ${u.activo?'badge-verde':'badge-rojo'}">${u.activo?'Activo':'Inactivo'}</span></td><td>${u.ultimo_acceso?formatDate(u.ultimo_acceso):'Nunca'}</td><td><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editUsuario(${u.id})">Editar rol</button><button class="sys-btn sys-btn-outline sys-btn-sm" onclick="toggleUsuario(${u.id},${!u.activo})">${u.activo?'Desact.':'Activar'}</button></td></tr>`).join('')
    :'<tr><td colspan="6" class="empty-row">Sin usuarios</td></tr>';
  const btnAdd=document.getElementById('btn-add-user');
  if(btnAdd) btnAdd.onclick=()=>{document.getElementById('usr-id').value='';['usr-nombre','usr-email','usr-password'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('usr-rol').value='recepcionista';document.getElementById('modal-usuario-title').textContent='Nuevo usuario';document.getElementById('usr-password-group').style.display='block';openModal('modal-usuario');};
}
async function editUsuario(id){
  const { data:u } = await sb.from('usuarios').select('*').eq('id',id).single();
  document.getElementById('usr-id').value=id;document.getElementById('modal-usuario-title').textContent='Editar usuario';document.getElementById('usr-nombre').value=u.nombre||'';document.getElementById('usr-email').value=u.email||'';document.getElementById('usr-rol').value=u.rol||'recepcionista';document.getElementById('usr-password-group').style.display='none';
  openModal('modal-usuario');
}
async function toggleUsuario(id,estado){await sb.from('usuarios').update({activo:estado}).eq('id',id);showToast('Actualizado','ok');loadUsuarios();}
function setupModalUsuario(){
  const btn=document.getElementById('btn-guardar-usuario');if(!btn)return;
  btn.addEventListener('click',async()=>{
    const id=document.getElementById('usr-id').value;
    const nombre=document.getElementById('usr-nombre').value.trim();
    const email=document.getElementById('usr-email').value.trim();
    const password=document.getElementById('usr-password')?.value;
    const rol=document.getElementById('usr-rol').value;
    if(!nombre||!email){showToast('Nombre y email obligatorios','err');return;}
    if(id){await sb.from('usuarios').update({nombre,rol}).eq('id',id);showToast('Usuario actualizado ✓','ok');}
    else{
      if(!password||password.length<6){showToast('Contraseña mínimo 6 caracteres','err');return;}
      btn.disabled=true;btn.textContent='Creando...';
      let authId=null;
      try{const resp=await fetch(`${SUPABASE_URL}/auth/v1/admin/users`,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY,'Authorization':`Bearer ${(await sb.auth.getSession()).data.session?.access_token}`},body:JSON.stringify({email,password,user_metadata:{nombre,rol},email_confirm:true})});const j=await resp.json();authId=j.id;}catch(e){}
      if(authId){await sb.from('usuarios').upsert({auth_id:authId,nombre,email,rol,activo:true},{onConflict:'email'});showToast('✅ Usuario creado','ok');}
      else{await sb.from('usuarios').upsert({nombre,email,rol,activo:true},{onConflict:'email'});showToast('⚠️ Perfil creado. Crea también el usuario en Supabase → Authentication → Add user.','ok');}
      btn.disabled=false;btn.textContent='Guardar usuario';
    }
    closeModal('modal-usuario');loadUsuarios();
  });
}

// ══════════════════════════════════════════════════════════
//  MODALES & UTILS
// ══════════════════════════════════════════════════════════
function setupModals(){
  document.querySelectorAll('.modal-close,[data-modal]').forEach(btn=>{
    btn.addEventListener('click',()=>{const modalId=btn.dataset.modal||btn.closest('.sys-modal')?.id;if(modalId)closeModal(modalId);});
  });
  document.querySelectorAll('.sys-modal').forEach(modal=>{modal.addEventListener('click',e=>{if(e.target===modal)closeModal(modal.id);});});
}
function openModal(id){const m=document.getElementById(id);if(m)m.style.display='flex';}
function closeModal(id){const m=document.getElementById(id);if(m)m.style.display='none';}
function showToast(msg,type='ok'){
  const t=document.getElementById('sys-toast');if(!t)return;
  t.textContent=msg;t.className=`sys-toast toast-${type}`;t.style.display='block';
  clearTimeout(t._timer);t._timer=setTimeout(()=>{t.style.display='none';},5000);
}
function formatDate(str){if(!str)return'—';return new Date(str).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'});}
function formatTime(str){if(!str)return'—';return new Date(str).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});}
function escStr(str){return(str||'').replace(/'/g,"\\'");}

// ══════════════════════════════════════════════════════════
//  RESERVAS WEB
// ══════════════════════════════════════════════════════════
async function loadReservasWeb(){
  const filterEstado=document.getElementById('filter-reserva-estado')?.value||'';
  const filterFecha=document.getElementById('filter-reserva-fecha')?.value||'';
  let q=sb.from('reservas_web').select('*').order('created_at',{ascending:false});
  if(filterEstado) q=q.eq('estado',filterEstado);
  if(filterFecha) q=q.eq('fecha_reserva',filterFecha);
  const { data:res } = await q;
  const pend=res?.filter(r=>r.estado==='pendiente').length||0;
  const conf=res?.filter(r=>r.estado==='confirmada').length||0;
  document.getElementById('reservas-stats').innerHTML=`
    <div class="stat-card-sys"><p>Total reservas</p><h3>${res?.length||0}</h3></div>
    <div class="stat-card-sys" style="border-left-color:var(--warning)"><p>Pendientes</p><h3>${pend}</h3></div>
    <div class="stat-card-sys" style="border-left-color:var(--success)"><p>Confirmadas</p><h3>${conf}</h3></div>`;
  document.getElementById('reservas-table').innerHTML=res?.length
    ?res.map(r=>`<tr>
        <td>${formatDate(r.fecha_reserva)}</td>
        <td><strong>${r.hora_llegada||'—'}</strong></td>
        <td><strong>${r.nombre_cliente||'—'}</strong></td>
        <td>${r.dni_cliente||'—'}</td>
        <td>${r.telefono||'—'}</td>
        <td>${r.habitacion_tipo||'—'}</td>
        <td>${r.num_huespedes||1}</td>
        <td><span class="badge badge-${r.estado==='pendiente'?'amarillo':r.estado==='confirmada'?'verde':'rojo'}">${r.estado}</span></td>
        <td style="font-size:11px">${formatDate(r.created_at)} ${formatTime(r.created_at)}</td>
        <td style="white-space:nowrap">
          <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="cambiarEstadoReserva(${r.id},'confirmada')">✅</button>
          <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="cambiarEstadoReserva(${r.id},'cancelada')">❌</button>
          <button class="sys-btn sys-btn-gold sys-btn-sm" onclick="hacerCheckinDesdeReserva(${r.id})">🛏 Check-in</button>
        </td>
      </tr>`).join('')
    :'<tr><td colspan="10" class="empty-row">No hay reservas</td></tr>';
  ['filter-reserva-estado','filter-reserva-fecha'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.removeAttribute('max');el.removeAttribute('min');if(!el._bound){el._bound=true;el.addEventListener('change',loadReservasWeb);}}
  });
}
async function cambiarEstadoReserva(id,estado){
  await sb.from('reservas_web').update({estado}).eq('id',id);
  showToast(`Reserva ${estado}`,'ok'); loadReservasWeb();
}
async function hacerCheckinDesdeReserva(id){
  const { data:r } = await sb.from('reservas_web').select('*').eq('id',id).single();
  if(!r) return;
  const cat=r.habitacion_tipo?.toLowerCase().split(' ')[0]||'';
  const { data:habs } = await sb.from('habitaciones').select('*').eq('estado','disponible').ilike('categoria','%'+cat+'%').limit(1);
  if(habs?.length){
    openCheckinModal(habs[0]);
    setTimeout(()=>{
      document.getElementById('ci-nombre').value=r.nombre_cliente||'';
      document.getElementById('ci-dni').value=r.dni_cliente||'';
      document.getElementById('ci-tel').value=r.telefono||'';
      document.getElementById('ci-email').value=r.email||'';
      document.getElementById('ci-huespedes').value=r.num_huespedes||1;
      document.getElementById('ci-entrada').value=r.fecha_reserva||fechaPeruHoy();
    },100);
    await sb.from('reservas_web').update({estado:'confirmada'}).eq('id',id);
  } else {
    showToast('No hay habitaciones disponibles de esa categoría','err');
  }
}

// ══════════════════════════════════════════════════════════
//  COMENTARIOS WEB
// ══════════════════════════════════════════════════════════
async function loadComentarios(){
  const filtroLeido=document.getElementById('filter-com-leido')?.value||'';
  let q=sb.from('comentarios_web').select('*').order('created_at',{ascending:false});
  if(filtroLeido==='true') q=q.eq('leido',true);
  else if(filtroLeido==='false') q=q.eq('leido',false);
  const { data:coms } = await q;
  const noLeidos=coms?.filter(c=>!c.leido).length||0;
  const badge=document.getElementById('comentarios-count');
  if(badge) badge.textContent=`${noLeidos} sin leer`;
  document.getElementById('comentarios-table').innerHTML=coms?.length
    ?coms.map(c=>`<tr>
        <td style="font-size:11px">${formatDate(c.created_at)}</td>
        <td><strong>${c.nombre||'—'}</strong></td>
        <td>${c.email||'—'}</td>
        <td>${c.asunto||'Sin asunto'}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${c.mensaje||'—'}</td>
        <td><span class="badge ${c.leido?'badge-verde':'badge-amarillo'}">${c.leido?'Leído':'Nuevo'}</span></td>
        <td style="white-space:nowrap">
          <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="verComentario(${c.id})">Ver</button>
          ${!c.leido?`<button class="sys-btn sys-btn-outline sys-btn-sm" onclick="marcarLeido(${c.id})">✓</button>`:''}
        </td>
      </tr>`).join('')
    :'<tr><td colspan="7" class="empty-row">No hay mensajes</td></tr>';
  const sel=document.getElementById('filter-com-leido');
  if(sel&&!sel._bound){sel._bound=true;sel.addEventListener('change',loadComentarios);}
}
async function verComentario(id){
  const { data:c } = await sb.from('comentarios_web').select('*').eq('id',id).single();
  if(!c) return;
  document.getElementById('modal-com-title').textContent=c.asunto||'Mensaje';
  document.getElementById('modal-com-body').innerHTML=`
    <div style="margin-bottom:14px">
      <div class="modal-info-row"><span>De</span><span><strong>${c.nombre}</strong></span></div>
      <div class="modal-info-row"><span>Email</span><span>${c.email||'—'}</span></div>
      <div class="modal-info-row"><span>Fecha</span><span>${formatDate(c.created_at)} ${formatTime(c.created_at)}</span></div>
    </div>
    <div style="background:var(--bg);padding:14px;border-radius:var(--radius-sm);line-height:1.6;font-size:13px">${c.mensaje||'—'}</div>
    <div class="form-actions">
      <button class="sys-btn sys-btn-outline" data-modal="modal-comentario">Cerrar</button>
      ${!c.leido?`<button class="sys-btn sys-btn-gold" onclick="marcarLeido(${c.id});closeModal('modal-comentario')">Marcar leído</button>`:''}
    </div>`;
  openModal('modal-comentario');
  if(!c.leido) await sb.from('comentarios_web').update({leido:true}).eq('id',id).then(()=>loadComentarios());
}
async function marcarLeido(id){
  await sb.from('comentarios_web').update({leido:true}).eq('id',id);
  showToast('Marcado como leído','ok'); loadComentarios();
}

// ══════════════════════════════════════════════════════════
//  NOTIFICACIONES REALTIME
// ══════════════════════════════════════════════════════════
let _notifChannel=null;

// Sonido de notificación (beep sintético con Web Audio API)
function reproducirSonidoNotif() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playBeep = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    playBeep(880, 0,    0.15);
    playBeep(1100, 0.18, 0.15);
    playBeep(1320, 0.36, 0.2);
  } catch(e) {}
}

let _lastNotifCount = 0;

async function initNotificaciones(){
  await cargarNotificaciones();
  if(_notifChannel) { try{ sb.removeChannel(_notifChannel); }catch(e){} }
  _notifChannel = sb.channel('notif-realtime-' + Date.now(), {
    config: { broadcast: { self: true } }
  })
  .on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'notificaciones'
  }, payload => {
    reproducirSonidoNotif();
    mostrarNotifToast(payload.new);
    cargarNotificaciones();
  })
  .subscribe((status) => {
    console.log('Notif channel status:', status);
  });
}
async function cargarNotificaciones(){
  const { data:notifs } = await sb.from('notificaciones').select('*').eq('leida',false).order('created_at',{ascending:false}).limit(20);
  const count=notifs?.length||0;
  const badge=document.getElementById('notif-badge');
  if(badge){badge.textContent=count;badge.style.display=count>0?'flex':'none';}
  // Play sound if new notifications appeared (polling fallback)
  if(count > _lastNotifCount && _lastNotifCount >= 0) {
    if(_lastNotifCount >= 0 && count > 0) { /* sound already played by realtime */ }
  }
  _lastNotifCount = count;
  const list=document.getElementById('notif-list');
  if(!list) return;
  list.innerHTML=notifs?.length
    ?notifs.map(n=>`<div class="notif-item unread" onclick="abrirNotif(${n.id},'${n.tipo}')">
        <div class="notif-item-title">${n.tipo==='reserva_web'?'🏨':'💬'} ${n.titulo||'Notificación'}</div>
        <div class="notif-item-msg">${n.mensaje||''}</div>
        <div class="notif-item-time">${formatTime(n.created_at)}</div>
      </div>`).join('')
    :'<div class="notif-empty">Sin notificaciones nuevas</div>';
}
function mostrarNotifToast(n){
  showToast(`🔔 ${n.titulo}: ${n.mensaje}`,'ok');
  // Flash notification bell
  const bell = document.getElementById('notif-btn');
  if(bell) {
    bell.style.animation = 'bellRing 0.6s ease 3';
    setTimeout(() => { bell.style.animation = ''; }, 2000);
  }
}
async function abrirNotif(id,tipo){
  await sb.from('notificaciones').update({leida:true}).eq('id',id);
  closeNotifPanel();
  if(tipo==='reserva_web') loadSection('reservas-web');
  else loadSection('comentarios');
  cargarNotificaciones();
}
function toggleNotifPanel(){
  const p=document.getElementById('notif-panel');
  if(p) p.style.display=p.style.display==='none'||!p.style.display?'block':'none';
}
function closeNotifPanel(){const p=document.getElementById('notif-panel');if(p)p.style.display='none';}
async function marcarTodasLeidas(){
  await sb.from('notificaciones').update({leida:true}).eq('leida',false);
  cargarNotificaciones(); closeNotifPanel();
}
document.addEventListener('click',e=>{
  const panel=document.getElementById('notif-panel');
  const btn=document.getElementById('notif-btn');
  if(panel&&btn&&!panel.contains(e.target)&&!btn.contains(e.target)) panel.style.display='none';
});

// ══════════════════════════════════════════════════════════
//  EDITAR MÉTODO DE PAGO COMPROBANTE (solo admin)
// ══════════════════════════════════════════════════════════
async function editarMetodoPago(id){
  if(currentUserProfile?.rol!=='admin'){showToast('Solo el administrador puede editar comprobantes','err');return;}
  const { data:comp } = await sb.from('comprobantes').select('serie,metodo_pago').eq('id',id).single();
  if(!comp) return;
  document.getElementById('edit-comp-id').value=id;
  document.getElementById('edit-comp-serie').value=comp.serie||'';
  const modal=document.getElementById('modal-editar-metodo');
  modal.querySelectorAll('.metodo-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.metodo===comp.metodo_pago);
    btn.onclick=()=>{modal.querySelectorAll('.metodo-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');};
  });
  openModal('modal-editar-metodo');
}
document.getElementById('btn-guardar-metodo')?.addEventListener('click',async()=>{
  const id=document.getElementById('edit-comp-id').value;
  const modal=document.getElementById('modal-editar-metodo');
  const metodo=modal.querySelector('.metodo-btn.active')?.dataset.metodo;
  if(!metodo||!id) return;

  // 1. Leer el comprobante completo para saber tipo y referencias
  const { data:comp } = await sb.from('comprobantes')
    .select('datos_json, tipo_serie, check_in_id, venta_publica_id')
    .eq('id',id).single();

  // 2. Actualizar datos_json para que el ticket reimpreso salga correcto
  let updateData = { metodo_pago: metodo };
  if(comp?.datos_json) {
    try {
      const datos = typeof comp.datos_json==='string' ? JSON.parse(comp.datos_json) : comp.datos_json;
      datos.metodoPago = metodo;
      updateData.datos_json = JSON.stringify(datos);
    } catch(e){}
  }
  await sb.from('comprobantes').update(updateData).eq('id',id);

  // 3. Actualizar la tabla de origen para que reportes refleje el cambio
  //    - HAB → check_ins.metodo_pago
  //    - PUB → ventas_publicas.metodo_pago
  if(comp?.tipo_serie==='HAB' && comp?.check_in_id) {
    await sb.from('check_ins').update({metodo_pago: metodo}).eq('id', comp.check_in_id);
  } else if(comp?.tipo_serie==='PUB' && comp?.venta_publica_id) {
    await sb.from('ventas_publicas').update({metodo_pago: metodo}).eq('id', comp.venta_publica_id);
  }

  showToast('Método de pago actualizado ✓ (visible en reportes y ticket)','ok');
  closeModal('modal-editar-metodo');
  loadComprobantes();
});


async function eliminarComprobante(id, tipo, checkInId, totalComp) {
  if(!confirm(`¿Anular este comprobante de S/. ${Number(totalComp).toFixed(2)}? Esta acción revertirá el registro y no se puede deshacer.`)) return;

  try {
    // 1. Obtener datos del comprobante
    const { data:comp } = await sb.from('comprobantes').select('*').eq('id',id).single();
    if(!comp){ showToast('Comprobante no encontrado','err'); return; }

    // 2. Eliminar el comprobante
    await sb.from('comprobantes').delete().eq('id',id);

    // 3. Si es de habitación → revertir check_in
    if(tipo==='HAB' && checkInId) {
      await sb.from('check_ins').update({
        check_out_real: null,
        total_cobrado: 0,
        metodo_pago: null,
        serie_comprobante: null
      }).eq('id', checkInId);
      // Volver la habitación a disponible
      const { data:ci } = await sb.from('check_ins').select('habitacion_id').eq('id',checkInId).single();
      if(ci?.habitacion_id) {
        await sb.from('habitaciones').update({estado:'disponible'}).eq('id',ci.habitacion_id);
      }
    }

    // 4. Si hay movimiento de caja asociado → revertirlo (crear egreso compensatorio)
    if(comp.caja_id) {
      // Buscar el movimiento de ingreso relacionado
      const { data:movs } = await sb.from('movimientos_caja')
        .select('*').eq('caja_id', comp.caja_id)
        .like('concepto', `%${tipo==='HAB'?'Check-out':'Venta'}%`)
        .order('created_at',{ascending:false}).limit(20);

      // Insertar movimiento de reversa
      await sb.from('movimientos_caja').insert({
        caja_id: comp.caja_id,
        concepto: `ANULACIÓN ${tipo==='HAB'?'hospedaje':'venta'} — comprobante #${id}`,
        tipo: 'egreso',
        monto: comp.total||0,
        usuario_id: currentUserProfile?.id,
      });
    }

    showToast('Comprobante anulado ✓ — Los registros han sido revertidos','ok');
    loadComprobantes();

  } catch(err) {
    console.error('Error al anular:', err);
    showToast('Error al anular: ' + (err.message||'ver consola'), 'err');
  }
}

// ══════════════════════════════════════════════════════════
//  HABITACIONES: AGREGAR / EDITAR / ELIMINAR (solo admin)
// ══════════════════════════════════════════════════════════
function abrirModalNuevaHab(){
  if(currentUserProfile?.rol!=='admin'){showToast('Solo admin','err');return;}
  document.getElementById('hab-edit-id').value='';
  document.getElementById('modal-hab-edit-title').textContent='Nueva Habitación';
  ['hab-edit-numero','hab-edit-precio','hab-edit-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('hab-edit-piso').value='1';
  document.getElementById('hab-edit-categoria').value='economico';
  openModal('modal-habitacion-edit');
}
async function editarHabitacion(id){
  if(currentUserProfile?.rol!=='admin'){showToast('Solo admin','err');return;}
  const { data:h } = await sb.from('habitaciones').select('*').eq('id',id).single();
  document.getElementById('hab-edit-id').value=id;
  document.getElementById('modal-hab-edit-title').textContent='Editar Habitación';
  document.getElementById('hab-edit-numero').value=h.numero||'';
  document.getElementById('hab-edit-piso').value=h.piso||1;
  document.getElementById('hab-edit-categoria').value=h.categoria||'economico';
  document.getElementById('hab-edit-precio').value=h.precio_noche||'';
  document.getElementById('hab-edit-desc').value=h.descripcion||'';
  openModal('modal-habitacion-edit');
}
document.getElementById('btn-guardar-habitacion')?.addEventListener('click',async()=>{
  const id=document.getElementById('hab-edit-id').value;
  const data={
    numero:parseInt(document.getElementById('hab-edit-numero').value)||0,
    piso:parseInt(document.getElementById('hab-edit-piso').value)||1,
    categoria:document.getElementById('hab-edit-categoria').value,
    precio_noche:parseFloat(document.getElementById('hab-edit-precio').value)||0,
    descripcion:document.getElementById('hab-edit-desc').value,
  };
  if(!data.numero){showToast('El número es obligatorio','err');return;}
  if(id) await sb.from('habitaciones').update(data).eq('id',id);
  else {data.estado='disponible'; await sb.from('habitaciones').insert(data);}
  showToast('Habitación guardada ✓','ok'); closeModal('modal-habitacion-edit'); loadHabitaciones();
});
async function eliminarHabitacion(id){
  if(currentUserProfile?.rol!=='admin'){showToast('Solo admin','err');return;}
  if(!confirm('¿Eliminar esta habitación? Acción irreversible.')) return;
  await sb.from('habitaciones').delete().eq('id',id);
  showToast('Habitación eliminada','ok'); loadHabitaciones();
}

// ══════════════════════════════════════════════════════════
//  EGRESOS
// ══════════════════════════════════════════════════════════
async function loadEgresos() {
  const fechaFiltro = document.getElementById('egreso-filtro-fecha')?.value || '';
  const catFiltro   = document.getElementById('egreso-filtro-cat')?.value || '';

  let q = sb.from('egresos').select('*, usuarios(nombre)').order('fecha',{ascending:false}).order('created_at',{ascending:false});
  if(fechaFiltro) q = q.eq('fecha', fechaFiltro);
  if(catFiltro)   q = q.eq('categoria', catFiltro);
  const { data:egresos } = await q;

  // Stats
  const totalEgresos = egresos?.reduce((s,e)=>s+(e.monto||0),0)||0;
  const catCounts = {};
  egresos?.forEach(e=>{ catCounts[e.categoria]=(catCounts[e.categoria]||0)+1; });
  const catLabels = {compra:'Compras',servicio:'Servicios',personal:'Personal',mantenimiento:'Mantenimiento',otros:'Otros'};

  document.getElementById('egresos-stats').innerHTML = `
    <div class="stat-card-sys" style="border-left-color:var(--danger)">
      <p>Total egresos</p><h3>S/. ${totalEgresos.toFixed(2)}</h3>
      <small>${egresos?.length||0} registros</small>
    </div>
    ${Object.entries(catCounts).map(([cat,cnt])=>`
      <div class="stat-card-sys">
        <p>${catLabels[cat]||cat}</p><h3>${cnt}</h3><small>registros</small>
      </div>`).join('')}`;

  // Tabla
  const BADGE = {compra:'badge-celeste',servicio:'badge-gold',personal:'badge-teal',mantenimiento:'badge-amarillo',otros:'badge-naranja'};
  document.getElementById('egresos-table').innerHTML = egresos?.length
    ? egresos.map(e=>`
        <tr>
          <td>${formatDate(e.fecha)}</td>
          <td><span class="badge ${BADGE[e.categoria]||'badge-gold'}">${catLabels[e.categoria]||e.categoria}</span></td>
          <td><strong>${e.descripcion||'—'}</strong>${e.proveedor?`<br><small style="color:var(--text-2)">${e.proveedor}</small>`:''}</td>
          <td>${e.num_doc||'—'}</td>
          <td>${e.tipo_doc||'—'}</td>
          <td><strong style="color:var(--danger)">S/. ${(e.monto||0).toFixed(2)}</strong></td>
          <td style="white-space:nowrap">
            <button class="sys-btn sys-btn-outline sys-btn-sm" onclick="editarEgreso(${e.id})">✏️ Editar</button>
            <button class="sys-btn sys-btn-red sys-btn-sm" onclick="eliminarEgreso(${e.id})">🗑</button>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty-row">Sin egresos registrados</td></tr>';

  // Botón nuevo
  const btn = document.getElementById('btn-nuevo-egreso');
  if(btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', () => abrirModalEgreso());
  }

  // Filtros
  ['egreso-filtro-fecha','egreso-filtro-cat'].forEach(id=>{
    const el = document.getElementById(id);
    if(el && !el._bound){ el._bound=true; el.removeAttribute('min'); el.removeAttribute('max'); el.addEventListener('change',loadEgresos); }
  });
}

function abrirModalEgreso(eg=null) {
  document.getElementById('eg-id').value         = eg?.id||'';
  document.getElementById('eg-fecha').value      = eg?.fecha || fechaPeruHoy();
  document.getElementById('eg-categoria').value  = eg?.categoria||'compra';
  document.getElementById('eg-descripcion').value= eg?.descripcion||'';
  document.getElementById('eg-proveedor').value  = eg?.proveedor||'';
  document.getElementById('eg-monto').value      = eg?.monto||'';
  document.getElementById('eg-tipo-doc').value   = eg?.tipo_doc||'boleta';
  document.getElementById('eg-num-doc').value    = eg?.num_doc||'';
  document.getElementById('eg-obs').value        = eg?.observaciones||'';
  document.getElementById('modal-egreso-title').innerHTML =
    `<i class="fas fa-arrow-circle-down" style="color:var(--danger);margin-right:8px"></i>${eg?'Editar':'Registrar'} Egreso`;
  // Conectar botón guardar CADA VEZ que abre el modal (así siempre funciona)
  const btnG = document.getElementById('btn-guardar-egreso');
  if(btnG) {
    btnG.onclick = null; // limpiar listener anterior
    btnG.onclick = guardarEgreso;
  }
  openModal('modal-egreso');
}

async function editarEgreso(id) {
  const { data:eg } = await sb.from('egresos').select('*').eq('id',id).single();
  if(eg) abrirModalEgreso(eg);
}

async function eliminarEgreso(id) {
  if(!confirm('¿Eliminar este egreso? Esta acción no se puede deshacer.')) return;
  await sb.from('egresos').delete().eq('id',id);
  showToast('Egreso eliminado','ok');
  loadEgresos();
}

async function guardarEgreso() {
  const id   = document.getElementById('eg-id').value;
  const data = {
    fecha:         document.getElementById('eg-fecha').value || fechaPeruHoy(),
    categoria:     document.getElementById('eg-categoria').value,
    descripcion:   document.getElementById('eg-descripcion').value.trim(),
    proveedor:     document.getElementById('eg-proveedor').value.trim()||null,
    monto:         parseFloat(document.getElementById('eg-monto').value)||0,
    tipo_doc:      document.getElementById('eg-tipo-doc').value,
    num_doc:       document.getElementById('eg-num-doc').value.trim()||null,
    observaciones: document.getElementById('eg-obs').value.trim()||null,
    usuario_id:    currentUserProfile?.id,
    caja_id:       cajaActual?.id||null,
  };
  if(!data.descripcion){ showToast('La descripción es obligatoria','err'); return; }
  if(data.monto<=0){ showToast('El monto debe ser mayor a 0','err'); return; }

  const { error } = id
    ? await sb.from('egresos').update(data).eq('id',id)
    : await sb.from('egresos').insert(data);

  if(error){ showToast('Error al guardar: '+error.message,'err'); return; }
  showToast(id?'Egreso actualizado ✓':'Egreso registrado ✓','ok');
  closeModal('modal-egreso');
  loadEgresos();
}



// ══════════════════════════════════════════════════════════
//  REPORTE PDF
// ══════════════════════════════════════════════════════════
async function descargarReportePDF() {
  const desde = document.getElementById('reporte-desde')?.value;
  const hasta  = document.getElementById('reporte-hasta')?.value;
  if(!desde||!hasta){ showToast('Selecciona el rango de fechas primero','err'); return; }

  showToast('Generando PDF...','ok');

  // Recolectar datos del DOM ya renderizado
  const periodo   = document.getElementById('rep-periodo-label')?.textContent || `${desde} — ${hasta}`;
  const totHabs   = document.getElementById('rep-tot-habs')?.textContent||'—';
  const disp      = document.getElementById('rep-disponibles')?.textContent||'—';
  const ocup      = document.getElementById('rep-ocupadas')?.textContent||'—';
  const mant      = document.getElementById('rep-mant')?.textContent||'—';
  const resHoy    = document.getElementById('rep-reservas-hoy')?.textContent||'—';
  const coP       = document.getElementById('rep-checkouts-periodo')?.textContent||'—';
  const totGen    = document.getElementById('rep-total-general')?.textContent||'S/. 0.00';
  const efect     = document.getElementById('rep-efectivo')?.textContent||'S/. 0.00';
  const otros     = document.getElementById('rep-otros')?.textContent||'S/. 0.00';
  const coComp    = document.getElementById('rep-co-completados')?.textContent||'0';
  const ventasC   = document.getElementById('rep-ventas-count')?.textContent||'0';
  const ventasS   = document.getElementById('rep-ventas-sub')?.textContent||'S/. 0.00';
  const egrVal    = document.getElementById('rep-egresos-val')?.textContent||'S/. 0.00';

  // Capturar tablas del DOM
  function tablaHTML(tbodyId, headers) {
    const tbody = document.getElementById(tbodyId);
    if(!tbody) return '<tr><td colspan="10">Sin datos</td></tr>';
    return tbody.innerHTML;
  }

  const habsRows  = tablaHTML('reporte-habitaciones');
  const tiendaRows= tablaHTML('reporte-ventas');
  const coRows    = tablaHTML('reporte-checkins');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte Hoteles Rio — ${periodo}</title>
<style>
  @page { size: A4; margin: 15mm 12mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1e1b4b; background:#fff; }
  
  /* Cabecera */
  .header { display:flex; align-items:center; justify-content:space-between; padding-bottom:10px; border-bottom:3px solid #7c3aed; margin-bottom:14px; }
  .header-logo { font-size:20px; font-weight:900; color:#7c3aed; }
  .header-sub  { font-size:11px; color:#6b7280; }
  .header-right { text-align:right; }
  .header-right .periodo { font-size:12px; font-weight:700; color:#1e1b4b; }
  .header-right .fecha   { font-size:10px; color:#6b7280; margin-top:2px; }

  /* KPI grids */
  .kpi-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:6px; margin-bottom:10px; }
  .kpi-card { border-radius:6px; padding:8px; text-align:center; }
  .kpi-val  { font-size:22px; font-weight:900; line-height:1; }
  .kpi-lbl  { font-size:9px; font-weight:600; margin-top:3px; opacity:.8; }
  .kpi-blue   { background:#dbeafe; color:#1e40af; }
  .kpi-green  { background:#d1fae5; color:#065f46; }
  .kpi-red    { background:#fee2e2; color:#991b1b; }
  .kpi-yellow { background:#fef3c7; color:#92400e; }
  .kpi-purple { background:#ede9fe; color:#5b21b6; }
  .kpi-gold   { background:#fef9c3; color:#854d0e; }

  .fin-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:14px; }
  .fin-card { border-radius:6px; padding:10px 12px; display:flex; align-items:center; gap:8px; }
  .fin-icon { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; flex-shrink:0; }
  .fin-lbl  { font-size:9px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; opacity:.75; }
  .fin-val  { font-size:16px; font-weight:900; line-height:1; margin:2px 0; }
  .fin-sub  { font-size:9px; opacity:.65; }
  .fin-tot  { background:#f0fdf4; color:#14532d; } .fin-tot .fin-icon  { background:#16a34a; color:#fff; }
  .fin-ef   { background:#f0fdf4; color:#166534; } .fin-ef .fin-icon   { background:#22c55e; color:#fff; }
  .fin-ot   { background:#eff6ff; color:#1e3a8a; } .fin-ot .fin-icon   { background:#3b82f6; color:#fff; }
  .fin-co   { background:#fdf4ff; color:#581c87; } .fin-co .fin-icon   { background:#9333ea; color:#fff; }
  .fin-ti   { background:#f0f9ff; color:#0c4a6e; } .fin-ti .fin-icon   { background:#0ea5e9; color:#fff; }
  .fin-eg   { background:#fff1f2; color:#881337; } .fin-eg .fin-icon   { background:#e11d48; color:#fff; }

  /* Tablas */
  .section-title { font-size:12px; font-weight:700; color:#1e1b4b; margin:12px 0 6px; padding-left:6px; border-left:3px solid #7c3aed; }
  .two-col { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; }
  th { background:#f5f3ff; padding:5px 8px; text-align:left; font-size:9px; font-weight:700; color:#6b7280; letter-spacing:.5px; text-transform:uppercase; }
  td { padding:5px 8px; font-size:10px; color:#374151; border-top:1px solid #e8e5f5; }
  tr:hover td { background:#faf7ff; }
  .empty-row { text-align:center; color:#9ca3af; font-style:italic; padding:12px!important; }
  .badge { display:inline-block; padding:1px 7px; border-radius:20px; font-size:9px; font-weight:600; }
  .badge-verde  { background:#d1fae5; color:#065f46; }
  .badge-rojo   { background:#fee2e2; color:#991b1b; }
  .badge-gold   { background:#ede9fe; color:#5b21b6; }
  .footer { margin-top:14px; padding-top:8px; border-top:1px solid #e8e5f5; text-align:center; font-size:9px; color:#9ca3af; }
  @media print { button { display:none!important; } }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="header-logo">🏨 HOTELES RIO</div>
    <div class="header-sub">Sistema de Gestión Interna</div>
  </div>
  <div class="header-right">
    <div class="periodo">📊 REPORTE DE GESTIÓN</div>
    <div class="fecha">${periodo}</div>
    <div class="fecha">Generado: ${new Date().toLocaleString('es-PE')}</div>
  </div>
</div>

<!-- KPIs habitaciones -->
<div class="kpi-grid">
  <div class="kpi-card kpi-blue">  <div class="kpi-val">${totHabs}</div><div class="kpi-lbl">Total habitaciones</div></div>
  <div class="kpi-card kpi-green"> <div class="kpi-val">${disp}</div>  <div class="kpi-lbl">Disponibles</div></div>
  <div class="kpi-card kpi-red">   <div class="kpi-val">${ocup}</div>  <div class="kpi-lbl">Ocupadas</div></div>
  <div class="kpi-card kpi-yellow"><div class="kpi-val">${mant}</div>  <div class="kpi-lbl">Mantenimiento</div></div>
  <div class="kpi-card kpi-purple"><div class="kpi-val">${resHoy}</div><div class="kpi-lbl">Reservas período</div></div>
  <div class="kpi-card kpi-gold">  <div class="kpi-val">${coP}</div>  <div class="kpi-lbl">Check-outs</div></div>
</div>

<!-- KPIs financieros -->
<div class="fin-grid">
  <div class="fin-card fin-tot"><div class="fin-icon">$</div><div><div class="fin-lbl">TOTAL GENERAL</div><div class="fin-val">${totGen}</div></div></div>
  <div class="fin-card fin-ef"> <div class="fin-icon">💵</div><div><div class="fin-lbl">EFECTIVO</div><div class="fin-val">${efect}</div><div class="fin-sub">por método</div></div></div>
  <div class="fin-card fin-ot"> <div class="fin-icon">💳</div><div><div class="fin-lbl">OTROS MÉTODOS</div><div class="fin-val">${otros}</div><div class="fin-sub">Tarjeta/Yape/Plin</div></div></div>
  <div class="fin-card fin-co"> <div class="fin-icon">✓</div><div><div class="fin-lbl">CHECK-OUTS COMPLETADOS</div><div class="fin-val">${coComp}</div></div></div>
  <div class="fin-card fin-ti"> <div class="fin-icon">🛒</div><div><div class="fin-lbl">VENTAS TIENDA</div><div class="fin-val">${ventasC}</div><div class="fin-sub">${ventasS}</div></div></div>
  <div class="fin-card fin-eg"> <div class="fin-icon">↓</div><div><div class="fin-lbl">EGRESOS DEL PERÍODO</div><div class="fin-val">${egrVal}</div></div></div>
</div>

<!-- Tablas -->
<div class="two-col">
  <div>
    <div class="section-title">🛏 Ingresos por Habitaciones + Consumos</div>
    <table>
      <thead><tr><th>Habitación</th><th>Usos</th><th>Total</th></tr></thead>
      <tbody>${habsRows}</tbody>
    </table>
  </div>
  <div>
    <div class="section-title">🛒 Ingresos Tienda Pública</div>
    <table>
      <thead><tr><th>Producto</th><th>Qty</th><th>Total</th></tr></thead>
      <tbody>${tiendaRows}</tbody>
    </table>
  </div>
</div>

<div class="section-title">📋 Detalle de Check-outs del período</div>
<table>
  <thead><tr><th>Serie</th><th>Hab.</th><th>Cliente</th><th>Check-in</th><th>Check-out</th><th>Hab. S/.</th><th>Consumos</th><th>Sanción</th><th>Pago</th><th>Total</th></tr></thead>
  <tbody>${coRows}</tbody>
</table>

<div class="footer">
  Hoteles Rio — Sistema de Gestión Interna • Reporte generado automáticamente
</div>

<div style="text-align:center;margin-top:16px">
  <button onclick="window.print()" style="padding:10px 28px;font-size:14px;cursor:pointer;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-family:sans-serif;font-weight:700">
    🖨 Imprimir / Guardar PDF
  </button>
</div>

</body></html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if(!win){ showToast('Permite ventanas emergentes para generar el PDF','err'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(()=> win.focus(), 300);
}


// ══════════════════════════════════════════════════════════
//  ALERTA DE STOCK BAJO AL LOGIN
// ══════════════════════════════════════════════════════════
async function checkStockAlert() {
  try {
    const { data:prods } = await sb.from('productos')
      .select('nombre, stock, stock_minimo')
      .eq('activo', true)
      .order('stock', {ascending: true});

    if(!prods?.length) return;

    // Productos con stock <= stock_minimo (o <= 5 si no tiene definido)
    const bajos = prods.filter(p => (p.stock||0) <= (p.stock_minimo||5));
    if(!bajos.length) return;

    // Llenar lista de productos
    const lista = document.getElementById('stock-alert-list');
    if(lista) {
      lista.innerHTML = bajos.slice(0,8).map(p=>
        `<div class="stock-alert-item">
          <span class="stock-alert-prod">${p.nombre}</span>
          <span class="stock-alert-qty ${p.stock<=0?'sin-stock':'stock-bajo'}">
            ${p.stock<=0?'Sin stock':'Stock: '+p.stock+' (mín '+( p.stock_minimo||5)+')'}
          </span>
        </div>`
      ).join('') + (bajos.length>8?`<div class="stock-alert-more">...y ${bajos.length-8} productos más</div>`:'');
    }

    openModal('modal-stock-alert');
  } catch(e) {
    console.warn('No se pudo verificar stock:', e);
  }
}

function irAlAlmacen() {
  closeModal('modal-stock-alert');
  loadSection('almacen');
  // Activar nav item de almacén
  document.querySelectorAll('.sys-nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector('[data-sec="almacen"]')?.classList.add('active');
}

// ══════════════════════════════════════════════════════════
//  TOP 5 PRODUCTOS — GRÁFICO DONUT
// ══════════════════════════════════════════════════════════
const TOP5_COLORS = [
  '#a78bfa','#6ee7b7','#7dd3fc','#f9a8d4','#fcd34d',
  '#c4b5fd','#34d399','#38bdf8','#f472b6','#fbbf24'
];

function renderTop5(productos, desde, hasta) {
  const card = document.getElementById('card-top5');
  if(!card) return;

  // Ordenar y tomar top 5
  const top5 = productos
    .filter(p => p.total > 0)
    .sort((a,b) => b.total - a.total)
    .slice(0, 5);

  if(!top5.length) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';

  // Periodo label
  const lbl = document.getElementById('top5-periodo');
  if(lbl) lbl.textContent = `${formatDate(desde)} — ${formatDate(hasta)}`;

  const totalVentas = top5.reduce((s,p) => s + p.total, 0);

  // ── Tabla ──
  const tbody = document.getElementById('top5-tbody');
  if(tbody) tbody.innerHTML = top5.map((p,i) => `
    <tr>
      <td>
        <span class="top5-dot" style="background:${TOP5_COLORS[i]}"></span>
        ${p.nombre}
      </td>
      <td>${p.cantidad}</td>
      <td><strong>S/. ${p.total.toFixed(2)}</strong></td>
    </tr>`).join('');

  // ── Leyenda ──
  const legend = document.getElementById('top5-legend');
  if(legend) legend.innerHTML = top5.map((p,i) => `
    <div class="top5-legend-item">
      <span class="top5-dot" style="background:${TOP5_COLORS[i]}"></span>
      <span class="top5-legend-name">${p.nombre}</span>
      <span class="top5-legend-pct">${((p.total/totalVentas)*100).toFixed(1)}%</span>
    </div>`).join('');

  // ── Canvas donut ──
  dibujarDonut(top5, totalVentas);
}

function dibujarDonut(top5, totalVentas) {
  const canvas = document.getElementById('top5-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W/2, cy = H/2;
  const R = Math.min(W,H)/2 - 10;  // radio externo
  const r = R * 0.52;               // radio interno (hueco del donut)

  ctx.clearRect(0, 0, W, H);

  // Calcular ángulos
  const segmentos = [];
  let startAngle = -Math.PI / 2; // empezar arriba
  top5.forEach((p, i) => {
    const pct = p.total / totalVentas;
    const endAngle = startAngle + pct * 2 * Math.PI;
    segmentos.push({ p, i, startAngle, endAngle, pct });
    startAngle = endAngle;
  });

  // Guardar segmentos para hover
  canvas._segmentos = segmentos;
  canvas._R = R; canvas._r = r; canvas._cx = cx; canvas._cy = cy;
  canvas._totalVentas = totalVentas;

  // Dibujar segmentos
  segmentos.forEach(seg => dibujarSegmento(ctx, seg, R, r, cx, cy, false));

  // Texto central
  ctx.fillStyle = '#1e1b4b';
  ctx.font = 'bold 13px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S/. ' + totalVentas.toFixed(0), cx, cy - 8);
  ctx.font = '10px Inter, Arial, sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText('total', cx, cy + 10);

  // Hover events
  if(!canvas._hoverBound) {
    canvas._hoverBound = true;

    canvas.addEventListener('mousemove', function(e) {
      const rect = canvas.getBoundingClientRect();
      // Escalar coordenadas según tamaño CSS vs canvas interno
      const scaleX = canvas.width  / rect.width;
      const scaleY = canvas.height / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top)  * scaleY;

      const { _segmentos:segs, _R:Ro, _r:ri, _cx:ox, _cy:oy } = canvas;
      const dx = mx - ox, dy = my - oy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const tooltip = document.getElementById('top5-tooltip');

      if(dist >= ri && dist <= Ro) {
        let ang = Math.atan2(dy, dx);
        if(ang < -Math.PI/2) ang += 2*Math.PI; // normalizar al rango del donut

        const seg = segs.find(s => ang >= s.startAngle && ang < s.endAngle);
        if(seg) {
          // Redibujar
          ctx.clearRect(0,0,W,H);
          segs.forEach(s => dibujarSegmento(ctx, s, Ro, ri, ox, oy, s===seg));
          // Texto central con el producto activo
          ctx.fillStyle = '#1e1b4b';
          ctx.font = 'bold 12px Inter, Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('S/. '+seg.p.total.toFixed(2), ox, oy-8);
          ctx.font = '9px Inter, Arial, sans-serif';
          ctx.fillStyle = '#6b7280';
          const shortName = seg.p.nombre.length>14 ? seg.p.nombre.substring(0,14)+'…' : seg.p.nombre;
          ctx.fillText(shortName, ox, oy+8);

          // Tooltip flotante
          if(tooltip) {
            tooltip.style.display = 'block';
            tooltip.innerHTML = `<strong>${seg.p.nombre}</strong><br>
              S/. ${seg.p.total.toFixed(2)} &nbsp;|&nbsp; ${(seg.pct*100).toFixed(1)}%<br>
              <small>${seg.p.cantidad} unidades</small>`;
            // Posición relativa al contenedor
            const wrap = canvas.parentElement;
            const wRect = wrap.getBoundingClientRect();
            let tx = e.clientX - wRect.left + 12;
            let ty = e.clientY - wRect.top  - 10;
            if(tx + 160 > wRect.width) tx = e.clientX - wRect.left - 170;
            tooltip.style.left = tx + 'px';
            tooltip.style.top  = ty + 'px';
          }
          return;
        }
      }
      // Fuera del donut: restaurar
      ctx.clearRect(0,0,W,H);
      segs.forEach(s => dibujarSegmento(ctx, s, Ro, ri, ox, oy, false));
      ctx.fillStyle = '#1e1b4b';
      ctx.font = 'bold 13px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S/. '+canvas._totalVentas.toFixed(0), ox, oy-8);
      ctx.font = '10px Inter, Arial, sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText('total', ox, oy+10);
      if(tooltip) tooltip.style.display = 'none';
    });

    canvas.addEventListener('mouseleave', function() {
      const { _segmentos:segs, _R:Ro, _r:ri, _cx:ox, _cy:oy } = canvas;
      ctx.clearRect(0,0,W,H);
      segs.forEach(s => dibujarSegmento(ctx, s, Ro, ri, ox, oy, false));
      ctx.fillStyle = '#1e1b4b';
      ctx.font = 'bold 13px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S/. '+canvas._totalVentas.toFixed(0), ox, oy-8);
      ctx.font = '10px Inter, Arial, sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText('total', ox, oy+10);
      const tooltip = document.getElementById('top5-tooltip');
      if(tooltip) tooltip.style.display = 'none';
    });
  }
}

function dibujarSegmento(ctx, seg, R, r, cx, cy, activo) {
  const gap = 0.015; // pequeño hueco entre segmentos
  const sa = seg.startAngle + gap;
  const ea = seg.endAngle   - gap;
  const scale = activo ? 1.05 : 1;

  ctx.save();
  if(activo) {
    // Efecto "saltar" hacia afuera
    const midAng = (seg.startAngle + seg.endAngle) / 2;
    ctx.translate(Math.cos(midAng)*6, Math.sin(midAng)*6);
  }

  ctx.beginPath();
  ctx.moveTo(cx + r*Math.cos(sa), cy + r*Math.sin(sa));
  ctx.arc(cx, cy, R*scale, sa, ea);
  ctx.arc(cx, cy, r,       ea, sa, true);
  ctx.closePath();

  ctx.fillStyle = TOP5_COLORS[seg.i];
  ctx.fill();

  // Borde sutil
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

// ══════════════════════════════════════════════════════════
//  DETALLE DE CAJA — MODAL RESUMEN ESTILO IMAGEN
// ══════════════════════════════════════════════════════════
let _cajaDetalleId = null;

async function abrirDetalleCaja(cajaId) {
  _cajaDetalleId = cajaId;

  const [
    { data:caja },
    { data:movs },
    { data:compHAB },
    { data:compPUB }
  ] = await Promise.all([
    sb.from('cajas').select('*, usuarios(nombre)').eq('id',cajaId).single(),
    sb.from('movimientos_caja').select('*').eq('caja_id',cajaId).order('created_at',{ascending:false}),
    sb.from('comprobantes').select('metodo_pago,total').eq('caja_id',cajaId).eq('tipo_serie','HAB'),
    sb.from('comprobantes').select('metodo_pago,total').eq('caja_id',cajaId).eq('tipo_serie','PUB'),
  ]);

  // Egresos del día
  let totalEgresos = 0;
  try {
    const { data:egr } = await sb.from('egresos').select('monto').eq('fecha', caja?.fecha||fechaPeruHoy());
    totalEgresos = (egr||[]).reduce((s,e)=>s+(e.monto||0),0);
  } catch(_){}

  // Calcular totales por categoría
  const totalHospedaje = (compHAB||[]).reduce((s,c)=>s+(c.total||0),0);
  // Consumos de habitacion = movimientos tipo ingreso que contienen "consumo" o "Consumo"
  const totalServHab = movs?.filter(m=>m.tipo==='ingreso'&&m.concepto?.toLowerCase().includes('consumo'))
    .reduce((s,m)=>s+(m.monto||0),0)||0;
  const totalVentasDir = (compPUB||[]).reduce((s,c)=>s+(c.total||0),0);
  // Otros ingresos = ingresos que no son checkout ni consumo
  const totalOtros = movs?.filter(m=>m.tipo==='ingreso'
    &&!m.concepto?.toLowerCase().includes('check-out')
    &&!m.concepto?.toLowerCase().includes('consumo'))
    .reduce((s,m)=>s+(m.monto||0),0)||0;

  const totalGeneral = (caja?.total||0);
  const totalSinApertura = totalGeneral; // monto apertura = 0 en este sistema

  // Resumen por método de pago
  const mMap = {};
  (compHAB||[]).forEach(c=>{ const m=c.metodo_pago||'Efectivo'; mMap[m]=(mMap[m]||0)+(c.total||0); });
  (compPUB||[]).forEach(c=>{ const m=c.metodo_pago||'Efectivo'; mMap[m]=(mMap[m]||0)+(c.total||0); });

  // Fechas/horas
  const fmtDT = ts => ts
    ? new Date(ts).toLocaleString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true})
    : '—';
  const horaAp = fmtDT(caja?.hora_apertura||caja?.created_at);
  const horaCi = caja?.hora_cierre ? fmtDT(caja.hora_cierre) : 'Aún abierta';

  // Render del resumen
  document.getElementById('mcd-titulo').textContent =
    `#${cajaId} — ${caja?.usuarios?.nombre||'—'} (${caja?.estado||'—'})`;

  document.getElementById('mcd-resumen').innerHTML = `
    <div class="mcd-fechas">
      <div><i class="fas fa-door-open" style="color:#22c55e"></i> Fecha Apertura: <strong>${horaAp}</strong></div>
      ${caja?.hora_cierre?`<div><i class="fas fa-door-closed" style="color:#ef4444"></i> Fecha Cierre: <strong>${horaCi}</strong></div>`:''}
    </div>
    <div class="mcd-categorias">
      <div class="mcd-cat-row">
        <span><i class="fas fa-bed"></i> Hospedaje:</span>
        <span>S/${totalHospedaje.toFixed(2)}</span>
      </div>
      <div class="mcd-cat-row">
        <span><i class="fas fa-concierge-bell"></i> Servicio hab:</span>
        <span>S/${totalServHab.toFixed(2)}</span>
      </div>
      <div class="mcd-cat-row">
        <span><i class="fas fa-shopping-cart"></i> Ventas Directas:</span>
        <span>S/${totalVentasDir.toFixed(2)}</span>
      </div>
      <div class="mcd-cat-row">
        <span><i class="fas fa-plus-circle"></i> Otros Ingresos:</span>
        <span>S/${totalOtros.toFixed(2)}</span>
      </div>
      <div class="mcd-cat-row mcd-egreso-row">
        <span><i class="fas fa-minus-circle"></i> Egresos:</span>
        <span>S/${totalEgresos.toFixed(2)}</span>
      </div>
    </div>
    <div class="mcd-divider"></div>
    <div class="mcd-total-row">
      <span>Total:</span>
      <span>S/${totalGeneral.toFixed(2)}</span>
    </div>
    <div class="mcd-total-row mcd-total-destacado">
      <span>Total sin apertura:</span>
      <span class="mcd-total-verde">S/${totalSinApertura.toFixed(2)}</span>
    </div>
    <div class="mcd-subtotal-note">Crédito y Cortesía no contable. (n/c)</div>
    <div class="mcd-metodos">
      ${Object.entries(mMap).map(([met,monto])=>`
        <div class="mcd-metodo-row">
          <span>${met}:</span>
          <span>S/${monto.toFixed(2)}</span>
        </div>`).join('')}
      ${Object.keys(mMap).length===0?'<div class="mcd-metodo-row"><span>Sin ventas registradas</span><span>—</span></div>':''}
    </div>`;

  // Movimientos en tabla
  document.getElementById('mcd-movimientos').innerHTML = movs?.length
    ? movs.map(m=>`
        <tr>
          <td>${formatTime(m.created_at)}</td>
          <td style="font-size:12px">${m.concepto||'—'}</td>
          <td><span class="badge ${m.tipo==='ingreso'?'badge-verde':'badge-rojo'}">${m.tipo}</span></td>
          <td>S/. ${(m.monto||0).toFixed(2)}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty-row">Sin movimientos</td></tr>';

  // Botón imprimir
  const btnT = document.getElementById('mcd-btn-ticket');
  if(btnT) btnT.onclick = () => imprimirCaja(cajaId);

  // También actualizar la tabla de movimientos en la sección principal
  const tbody = document.getElementById('caja-movimientos');
  if(tbody) tbody.innerHTML = movs?.length
    ? movs.map(m=>`<tr><td>${formatTime(m.created_at)}</td><td>${m.concepto}</td><td><span class="badge ${m.tipo==='ingreso'?'badge-verde':'badge-rojo'}">${m.tipo}</span></td><td>S/. ${m.monto?.toFixed(2)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty-row">Sin movimientos</td></tr>';

  openModal('modal-caja-detalle');
}

// ══════════════════════════════════════════════════════════
//  TOP HABITACIONES — GRÁFICO DONUT
// ══════════════════════════════════════════════════════════
const TOPHABS_COLORS = [
  '#818cf8','#34d399','#fb923c','#f472b6','#38bdf8',
  '#a78bfa','#6ee7b7','#fcd34d','#f9a8d4','#7dd3fc'
];

function renderTopHabs(habitaciones, desde, hasta) {
  const card = document.getElementById('card-top-habs');
  if(!card) return;

  // Ordenar por usos (o total) y tomar top 5
  const topH = habitaciones
    .filter(h => h.usos > 0)
    .sort((a,b) => b.usos - a.usos)
    .slice(0, 5);

  if(!topH.length) { card.style.display = 'none'; return; }
  card.style.display = '';

  const lbl = document.getElementById('tophabs-periodo');
  if(lbl) lbl.textContent = `${formatDate(desde)} — ${formatDate(hasta)}`;

  const totalUsos = topH.reduce((s,h)=>s+h.usos, 0);

  // Tabla
  const tbody = document.getElementById('tophabs-tbody');
  if(tbody) tbody.innerHTML = topH.map((h,i)=>`
    <tr>
      <td>
        <span class="top5-dot" style="background:${TOPHABS_COLORS[i]}"></span>
        ${h.label||CATEGORIA_LABELS[h.cat]||h.cat||'—'}
        <span class="badge badge-gold" style="font-size:9px">${CATEGORIA_LABELS[h.cat]||h.cat||'—'}</span>
      </td>
      <td>${h.usos}</td>
      <td><strong>S/. ${h.total.toFixed(2)}</strong></td>
    </tr>`).join('');

  // Leyenda
  const legend = document.getElementById('tophabs-legend');
  if(legend) legend.innerHTML = topH.map((h,i)=>`
    <div class="top5-legend-item">
      <span class="top5-dot" style="background:${TOPHABS_COLORS[i]}"></span>
      <span class="top5-legend-name">${h.label||CATEGORIA_LABELS[h.cat]||h.cat||'—'} (${CATEGORIA_LABELS[h.cat]||h.cat||'—'})</span>
      <span class="top5-legend-pct">${((h.usos/totalUsos)*100).toFixed(1)}%</span>
    </div>`).join('');

  // Donut reutilizando la misma lógica pero con canvas y tooltip distintos
  dibujarDonutGenerico('tophabs-canvas', 'tophabs-tooltip', topH, TOPHABS_COLORS,
    (h) => `${h.label||CATEGORIA_LABELS[h.cat]||h.cat||'—'}`,
    (h) => `S/. ${h.total.toFixed(2)}`,
    (h) => `${h.usos} uso${h.usos!==1?'s':''}`,
    (h,tot) => h.usos/tot,
    totalUsos,
    totalUsos + ' usos'
  );
}

// Versión genérica del donut para reutilizar con habitaciones y productos
function dibujarDonutGenerico(canvasId, tooltipId, items, colors,
    fnLabel, fnVal, fnSub, fnPct, total, centerText) {
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W/2, cy = H/2;
  const R = Math.min(W,H)/2 - 10;
  const r = R * 0.52;

  ctx.clearRect(0,0,W,H);

  const segmentos = [];
  let startAngle = -Math.PI/2;
  items.forEach((item,i) => {
    const pct = fnPct(item,total);
    const endAngle = startAngle + pct*2*Math.PI;
    segmentos.push({ item, i, startAngle, endAngle, pct });
    startAngle = endAngle;
  });

  canvas._segmentos = segmentos;
  canvas._R=R; canvas._r=r; canvas._cx=cx; canvas._cy=cy;
  canvas._total=total; canvas._centerText=centerText;
  canvas._colors=colors;

  segmentos.forEach(seg => dibujarSegmentoGenerico(ctx, seg, R, r, cx, cy, false, colors));

  // Texto central
  ctx.fillStyle='#1e1b4b'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='bold 12px Inter,Arial,sans-serif';
  ctx.fillText(centerText, cx, cy-8);
  ctx.font='10px Inter,Arial,sans-serif'; ctx.fillStyle='#6b7280';
  ctx.fillText('total', cx, cy+10);

  if(!canvas._hoverBound) {
    canvas._hoverBound=true;
    const tooltip = document.getElementById(tooltipId);

    canvas.addEventListener('mousemove', function(e) {
      const rect = canvas.getBoundingClientRect();
      const mx=(e.clientX-rect.left)*(canvas.width/rect.width);
      const my=(e.clientY-rect.top)*(canvas.height/rect.height);
      const {_segmentos:segs,_R:Ro,_r:ri,_cx:ox,_cy:oy,_colors:cls} = canvas;
      const dx=mx-ox, dy=my-oy, dist=Math.sqrt(dx*dx+dy*dy);

      if(dist>=ri&&dist<=Ro) {
        let ang=Math.atan2(dy,dx);
        if(ang<-Math.PI/2) ang+=2*Math.PI;
        const seg=segs.find(s=>ang>=s.startAngle&&ang<s.endAngle);
        if(seg) {
          ctx.clearRect(0,0,W,H);
          segs.forEach(s=>dibujarSegmentoGenerico(ctx,s,Ro,ri,ox,oy,s===seg,cls));
          ctx.fillStyle='#1e1b4b'; ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.font='bold 11px Inter,Arial,sans-serif';
          const lbl=fnLabel(seg.item); const shortLbl=lbl.length>14?lbl.substring(0,14)+'…':lbl;
          ctx.fillText(fnVal(seg.item), ox, oy-8);
          ctx.font='9px Inter,Arial,sans-serif'; ctx.fillStyle='#6b7280';
          ctx.fillText(shortLbl, ox, oy+8);
          if(tooltip) {
            tooltip.style.display='block';
            tooltip.innerHTML=`<strong>${fnLabel(seg.item)}</strong><br>${fnVal(seg.item)} &nbsp;|&nbsp; ${(seg.pct*100).toFixed(1)}%<br><small>${fnSub(seg.item)}</small>`;
            const wrap=canvas.parentElement, wRect=wrap.getBoundingClientRect();
            let tx=e.clientX-wRect.left+12, ty=e.clientY-wRect.top-10;
            if(tx+170>wRect.width) tx=e.clientX-wRect.left-175;
            tooltip.style.left=tx+'px'; tooltip.style.top=ty+'px';
          }
          return;
        }
      }
      // Restaurar
      ctx.clearRect(0,0,W,H);
      segs.forEach(s=>dibujarSegmentoGenerico(ctx,s,Ro,ri,ox,oy,false,cls));
      ctx.fillStyle='#1e1b4b'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font='bold 12px Inter,Arial,sans-serif';
      ctx.fillText(canvas._centerText,ox,oy-8);
      ctx.font='10px Inter,Arial,sans-serif'; ctx.fillStyle='#6b7280';
      ctx.fillText('total',ox,oy+10);
      if(tooltip) tooltip.style.display='none';
    });
    canvas.addEventListener('mouseleave',function(){
      const {_segmentos:segs,_R:Ro,_r:ri,_cx:ox,_cy:oy,_colors:cls}=canvas;
      ctx.clearRect(0,0,W,H);
      segs.forEach(s=>dibujarSegmentoGenerico(ctx,s,Ro,ri,ox,oy,false,cls));
      ctx.fillStyle='#1e1b4b'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font='bold 12px Inter,Arial,sans-serif';
      ctx.fillText(canvas._centerText,ox,oy-8);
      ctx.font='10px Inter,Arial,sans-serif'; ctx.fillStyle='#6b7280';
      ctx.fillText('total',ox,oy+10);
      const tooltip=document.getElementById(tooltipId);
      if(tooltip) tooltip.style.display='none';
    });
  }
}

function dibujarSegmentoGenerico(ctx, seg, R, r, cx, cy, activo, colors) {
  const gap=0.015, sa=seg.startAngle+gap, ea=seg.endAngle-gap;
  ctx.save();
  if(activo){ const m=(seg.startAngle+seg.endAngle)/2; ctx.translate(Math.cos(m)*6,Math.sin(m)*6); }
  ctx.beginPath();
  ctx.moveTo(cx+r*Math.cos(sa),cy+r*Math.sin(sa));
  ctx.arc(cx,cy,activo?R*1.05:R,sa,ea);
  ctx.arc(cx,cy,r,ea,sa,true);
  ctx.closePath();
  ctx.fillStyle=colors[seg.i]; ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
  ctx.restore();
}

// ══════════════════════════════════════════════════════════
//  DESCARGAR REPORTE CAJA — PDF estilo reporte profesional
// ══════════════════════════════════════════════════════════
async function descargarReporteCaja(cajaId) {
  showToast('Generando reporte...','ok');

  const [
    {data:caja},
    {data:compHAB},
    {data:compPUB}
  ] = await Promise.all([
    sb.from('cajas').select('*, usuarios(nombre)').eq('id',cajaId).single(),
    sb.from('comprobantes').select('metodo_pago,total,datos_json,check_in_id').eq('caja_id',cajaId).eq('tipo_serie','HAB').order('created_at'),
    sb.from('comprobantes').select('metodo_pago,total,datos_json').eq('caja_id',cajaId).eq('tipo_serie','PUB').order('created_at'),
  ]);

  let totalEgresos = 0, egrRows = '';
  try {
    const {data:egr} = await sb.from('egresos').select('*').eq('fecha', caja?.fecha||fechaPeruHoy());
    totalEgresos = (egr||[]).reduce((s,e)=>s+(e.monto||0),0);
    egrRows = (egr||[]).map(e=>`<tr><td>${e.categoria||'—'}</td><td>${e.descripcion||'—'}</td><td>S/${(e.monto||0).toFixed(2)}</td><td>${e.metodo_pago||'—'}</td></tr>`).join('');
  } catch(_){}

  const usuario = caja?.usuarios?.nombre || '—';
  const fmtDT = ts => ts ? new Date(ts).toLocaleString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) : '—';
  const horaAp = fmtDT(caja?.hora_apertura||caja?.created_at);
  const horaCi = caja?.hora_cierre ? fmtDT(caja.hora_cierre) : '—';
  const totalGeneral = caja?.total||0;

  // Métodos de pago
  const mMap = {Efectivo:0, Yape:0, Plin:0, Tarjeta:0};
  (compHAB||[]).forEach(c=>{const m=c.metodo_pago||'Efectivo';mMap[m]=(mMap[m]||0)+(c.total||0);});
  (compPUB||[]).forEach(c=>{const m=c.metodo_pago||'Efectivo';mMap[m]=(mMap[m]||0)+(c.total||0);});

  // Detalle de hospedaje
  let totalHosp = 0;
  const hospeRows = (compHAB||[]).map(c=>{
    try {
      const d = typeof c.datos_json==='string' ? JSON.parse(c.datos_json) : c.datos_json;
      const num = d?.room?.numero ? String(d.room.numero).padStart(3,'0') : '?';
      const cat = (CATEGORIA_LABELS[d?.room?.categoria]||d?.room?.categoria||'—').toUpperCase();
      const pen = d?.penalizacion||0;
      const desc = d?.descuento||0;
      const mult = d?.multa||0;
      const fechaCo = d?.fecha ? new Date(d.fecha).toLocaleString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) : '—';
      const totalFila = c.total||0;
      totalHosp += totalFila;
      const extras = [
        pen>0  ? `+S/${pen.toFixed(2)} sanción` : '',
        desc>0 ? `-S/${desc.toFixed(2)} descuento` : '',
        mult>0 ? `+S/${mult.toFixed(2)} multa` : '',
      ].filter(Boolean).join(', ');
      return `<tr>
        <td>${cat} ${num}</td>
        <td>${usuario}</td>
        <td>${d?.checkin?.dni_huesped||'—'}</td>
        <td>S/${(d?.totalHab||0).toFixed(2)}${extras?`<br><small style="color:#6b7280">${extras}</small>`:''}
        <td>S/${totalFila.toFixed(2)}</td>
        <td style="color:${c.metodo_pago==='Efectivo'?'#16a34a':'#2563eb'}">${c.metodo_pago||'—'}</td>
        <td>${fechaCo}</td>
      </tr>`;
    } catch(_){ return '<tr><td colspan="7">—</td></tr>'; }
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:#9ca3af;font-style:italic">Sin hospedaje registrado</td></tr>';

  // Detalle servicios: consumos por habitación + tienda pública
  let totalServ = 0;
  let servicioRows = '';
  for(const c of (compHAB||[])){
    try{
      const d = typeof c.datos_json==='string' ? JSON.parse(c.datos_json) : c.datos_json;
      if(d?.consumos?.length){
        const num = d?.room?.numero ? String(d.room.numero).padStart(3,'0') : '?';
        const cat = (CATEGORIA_LABELS[d?.room?.categoria]||d?.room?.categoria||'—').toUpperCase();
        d.consumos.forEach(con=>{
          const sub = (con.precio_total||0);
          totalServ += sub;
          servicioRows += `<tr>
            <td>${cat} ${num}</td><td>${usuario}</td>
            <td>${con.productos?.nombre||'—'}</td>
            <td>S/${(con.precio_unitario||0).toFixed(2)}</td>
            <td style="text-align:center">${con.cantidad}</td>
            <td>S/${sub.toFixed(2)}</td>
            <td style="color:${c.metodo_pago==='Efectivo'?'#16a34a':'#2563eb'}">${c.metodo_pago||'—'}</td>
          </tr>`;
        });
      }
    }catch(_){}
  }
  for(const v of (compPUB||[])){
    try{
      const d = typeof v.datos_json==='string' ? JSON.parse(v.datos_json) : v.datos_json;
      const items = d?.items || d?.lineas || d?.carrito || [];
      if(Array.isArray(items) && items.length){
        items.forEach(it=>{
          const nombre = it?.nombre || it?.[1]?.nombre || '—';
          const precio = Number(it?.precio||it?.[1]?.precio||0);
          const cant   = Number(it?.cantidad||it?.[1]?.cantidad||1);
          const sub = precio*cant;
          totalServ += sub;
          servicioRows += `<tr>
            <td>Tienda Pública</td><td>${usuario}</td>
            <td>${nombre}</td>
            <td>S/${precio.toFixed(2)}</td>
            <td style="text-align:center">${cant}</td>
            <td>S/${sub.toFixed(2)}</td>
            <td style="color:${v.metodo_pago==='Efectivo'?'#16a34a':'#2563eb'}">${v.metodo_pago||'—'}</td>
          </tr>`;
        });
      } else {
        // Fallback: mostrar la venta pública como un ítem
        const sub = v.total||0;
        totalServ += sub;
        servicioRows += `<tr>
          <td>Tienda Pública</td><td>${usuario}</td>
          <td>Venta #${v.id||'—'}</td><td>—</td>
          <td style="text-align:center">1</td>
          <td>S/${sub.toFixed(2)}</td>
          <td style="color:${v.metodo_pago==='Efectivo'?'#16a34a':'#2563eb'}">${v.metodo_pago||'—'}</td>
        </tr>`;
      }
    }catch(_){}
  }
  if(!servicioRows) servicioRows = '<tr><td colspan="7" style="text-align:center;color:#9ca3af;font-style:italic">Sin servicios registrados</td></tr>';

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Reporte Caja — ${usuario} — ${caja?.fecha||''}</title>
<style>
@page{size:A4;margin:14mm 12mm}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#1f2937;background:#fff}
.header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #1f2937;padding-bottom:10px;margin-bottom:12px}
.header-left h1{font-size:18px;font-weight:900;letter-spacing:.5px}
.header-left .sub{font-size:11px;color:#6b7280;margin-top:2px}
.header-right{text-align:right;font-size:10px;line-height:1.8}
.info-block{margin-bottom:10px;font-size:11px;line-height:2}
.info-block strong{display:inline-block;min-width:180px}
.montos{margin:8px 0 12px;font-size:12px;font-weight:700}
.section{font-size:11px;font-weight:800;margin:12px 0 5px;padding:4px 8px;background:#f3f4f6;border-left:3px solid #374151}
.metodos-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:6px 0 10px}
.mc{border:1px solid #d1d5db;border-radius:5px;padding:6px;text-align:center}
.mc .lbl{font-size:8px;font-weight:700;color:#374151;padding-bottom:3px;margin-bottom:3px;border-bottom:1px solid #e5e7eb}
.mc .val{font-size:13px;font-weight:900}
table{width:100%;border-collapse:collapse;margin-bottom:4px}
th{background:#374151;color:#fff;padding:5px 7px;font-size:9px;font-weight:700;text-align:left}
td{padding:5px 7px;border:1px solid #e5e7eb;font-size:9px;vertical-align:top}
tr:nth-child(even) td{background:#f9fafb}
.total-row td{font-weight:700;background:#f3f4f6;font-size:10px}
@media print{button{display:none!important}}
</style></head><body>

<div class="header">
  <div class="header-left">
    <h1>HOTELES RIO</h1>
    <div class="sub">Reporte de caja ${caja?.estado==='cerrada'?'cerrada':'(en proceso)'}</div>
  </div>
  <div class="header-right">
    <strong>N°${cajaId}</strong><br>
    ${new Date().toLocaleDateString('es-PE')}
  </div>
</div>

<div class="info-block">
  <strong>Fecha apertura:</strong> ${horaAp} &nbsp;&nbsp; <strong>Responsable apertura:</strong> ${usuario}<br>
  ${caja?.hora_cierre?`<strong>Fecha cierre:</strong> ${horaCi} &nbsp;&nbsp; <strong>Responsable cierre:</strong> ${usuario}`:'<strong>Estado:</strong> Aún abierta'}
</div>
<div class="montos">
  Apertura: S/0.00 &nbsp;&nbsp;&nbsp; Monto de cierre sin apertura: <span style="font-size:14px">S/${totalGeneral.toFixed(2)}</span>
</div>

<div class="section">Métodos de pago</div>
<div class="metodos-grid">
  <div class="mc"><div class="lbl">Efectivo(Efec)</div><div class="val">S/${mMap.Efectivo.toFixed(2)}</div></div>
  <div class="mc"><div class="lbl">Yape</div><div class="val">S/${mMap.Yape.toFixed(2)}</div></div>
  <div class="mc"><div class="lbl">Plin</div><div class="val">S/${mMap.Plin.toFixed(2)}</div></div>
  <div class="mc"><div class="lbl">Tarjeta(Tarj)</div><div class="val">S/${mMap.Tarjeta.toFixed(2)}</div></div>
  <div class="mc"><div class="lbl" style="color:#dc2626">Egresos(-)</div><div class="val" style="color:#dc2626">S/${totalEgresos.toFixed(2)}</div></div>
</div>

<div class="section">Detalle de hospedaje</div>
<table>
  <thead><tr><th>Habitación</th><th>Responsable</th><th>Identificador</th><th>Total hospedaje</th><th>Total en caja</th><th>Método de pago</th><th>Fecha check-out</th></tr></thead>
  <tbody>${hospeRows}</tbody>
  <tr class="total-row">
    <td colspan="3">Total:</td>
    <td colspan="4">S/${totalHosp.toFixed(2)} &nbsp;&nbsp; Total sin crédito/cortesía: S/${totalHosp.toFixed(2)}</td>
  </tr>
</table>

<div class="section">Detalle servicio a la habitación y ventas directas</div>
<table>
  <thead><tr><th>Habitación</th><th>Responsable</th><th>Artículo</th><th>Prec. Uni</th><th>Cant</th><th>Registrado en caja</th><th>Método de pago</th></tr></thead>
  <tbody>${servicioRows}</tbody>
  <tr class="total-row">
    <td colspan="5">Total:</td>
    <td colspan="2">S/${totalServ.toFixed(2)} &nbsp;&nbsp; Total sin crédito/cortesía: S/${totalServ.toFixed(2)}</td>
  </tr>
</table>

${egrRows?`
<div class="section">Detalle egresos</div>
<table>
  <thead><tr><th>Categoría</th><th>Descripción</th><th>Monto</th><th>Método</th></tr></thead>
  <tbody>${egrRows}</tbody>
  <tr class="total-row"><td colspan="2">Total egresos:</td><td colspan="2">S/${totalEgresos.toFixed(2)} (-)</td></tr>
</table>`:''}

<div style="text-align:center;margin-top:16px">
  <button onclick="window.print()" style="padding:10px 28px;font-size:14px;cursor:pointer;background:#374151;color:#fff;border:none;border-radius:6px;font-family:sans-serif;font-weight:700">
    🖨 Imprimir / Guardar PDF
  </button>
</div>
</body></html>`;

  const win = window.open('', '_blank', 'width=950,height=720');
  if(!win){ showToast('Permite ventanas emergentes para descargar','err'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(()=>win.focus(), 300);
}
