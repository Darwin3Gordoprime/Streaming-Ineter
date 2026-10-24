const departments = [
  ['Boaco',12.4693,-85.6586],['Carazo',11.8496,-86.199],['Chinandega',12.6294,-87.131],['Chontales',12.1063,-85.3645],['Estelí',13.0919,-86.3538],['Granada',11.9344,-85.956],['Jinotega',13.091,-86.001],['León',12.435,-86.879],['Madriz',13.4808,-86.582],['Managua',12.1364,-86.251],['Masaya',11.9744,-86.094],['Matagalpa',12.9256,-85.917],['Nueva Segovia',13.632,-86.475],['Río San Juan',11.123,-84.777],['Rivas',11.437,-85.83],['Costa Caribe Norte',14.035,-83.388],['Costa Caribe Sur',12.013,-83.764]
];
document.querySelectorAll('.service-view[data-view="pronostico"],.service-view[data-view="mapa"],.service-view[data-view="datos"]').forEach(node=>node.remove());
document.querySelector('#planificador').insertAdjacentHTML('beforebegin', `
  <section class="panel service-view climate-service" data-view="pronostico"><div class="panel-heading"><div><h2>Pronóstico climático por departamento</h2><p>Condiciones actuales y tendencia de los próximos días en Nicaragua.</p><small class="live-data-stamp" id="national-weather-updated" role="status">Cargando datos</small></div><button class="text-button" type="button" id="refresh-national-weather">Actualizar ↻</button></div><div class="climate-toolbar"><label class="field-label" for="national-department">Departamento o región<select id="national-department"></select></label><a class="button secondary" href="https://servmet.ineter.gob.ni/Pronostico/" target="_blank" rel="noopener">Pronóstico oficial INETER ↗</a></div><div id="department-forecast" class="department-forecast"><p class="empty-recordings">Consultando pronósticos…</p></div><small class="forecast-attribution">Estimaciones de referencia de Open-Meteo para las cabeceras departamentales; no son estaciones observadas. Confirma la información oficial de INETER.</small></section>
  <section class="panel service-view climate-service" data-view="mapa"><div class="panel-heading"><div><h2>Mapa climático de Nicaragua</h2><p>Vista regional de temperatura y probabilidad de lluvia estimadas.</p></div><span class="tag neutral">REFERENCIA METEOROLÓGICA</span></div><div id="climate-map" class="climate-map-grid"><p class="empty-recordings">Cargando datos por región…</p></div><a class="service-secondary-link" href="https://www.ineter.gob.ni/geoportales/variabilidadclimatica/index.html" target="_blank" rel="noopener">Abrir el atlas climático histórico de INETER ↗</a></section>
  <section class="panel service-view climate-service" data-view="alertas"><div class="panel-heading"><div><h2>Vigilancia climática</h2><p>Indicadores meteorológicos que requieren atención por región.</p></div><span class="tag neutral" id="climate-alert-count">ACTUALIZANDO</span></div><div id="climate-alerts" class="climate-alert-list"><p class="empty-recordings">Analizando el pronóstico…</p></div><p class="forecast-attribution">Estas señales automáticas son orientativas y no constituyen alertas oficiales. Para emergencias, sigue los avisos de INETER y SINAPRED.</p><a class="button secondary" href="https://www.ineter.gob.ni/direccion-general-de-meteorologia/" target="_blank" rel="noopener">Avisos oficiales de INETER ↗</a></section>
  <section class="panel service-view climate-service" data-view="datos"><div class="panel-heading"><div><h2>Resumen de datos climáticos</h2><p>Valores de referencia por cabecera departamental, actualizados automáticamente.</p></div><span class="tag neutral">17 REGIONES</span></div><div class="table-scroll"><table class="climate-table"><thead><tr><th>Departamento / región</th><th>Condición</th><th>Temp.</th><th>Humedad</th><th>Lluvia hoy</th><th>Viento</th></tr></thead><tbody id="climate-data-rows"><tr><td colspan="6">Consultando datos…</td></tr></tbody></table></div><small class="forecast-attribution">Puntos geográficos de referencia; no representan sensores ni estaciones oficiales de INETER. Fuente: Open-Meteo.</small><a class="service-secondary-link" href="https://www.ineter.gob.ni/infraestructura-de-datos-espaciales-de-ineter/geoservicios-de-la-ide-ineter/" target="_blank" rel="noopener">Geoservicios IDE-INETER ↗</a></section>`);
const initialView = location.hash.slice(1) || 'inicio';
document.querySelectorAll('.climate-service').forEach(panel => {
  panel.dataset.originalDisplay = 'block';
  panel.style.display = initialView === 'inicio' || initialView === panel.dataset.view ? 'block' : 'none';
});
const departmentState = new Map();
const departmentSelect = document.querySelector('#national-department');
let nationalWeatherBusy = false;
let nationalWeatherPending = false;
let nationalWeatherUpdatedAt = 0;
const nationalWeatherRefreshMs = 15 * 60 * 1000;
const weatherText = code => code >= 95 ? 'Tormenta' : (code >= 51 && code <= 82) ? 'Lluvia' : code >= 45 ? 'Neblina' : code === 0 ? 'Despejado' : code <= 2 ? 'Parcialmente nublado' : 'Nublado';
const formatDay = value => new Intl.DateTimeFormat('es-NI',{weekday:'long',day:'numeric',month:'short'}).format(new Date(`${value}T12:00:00`));
departmentSelect.innerHTML = departments.map(([name])=>`<option>${name}</option>`).join('');

function renderNationalClimate() {
  const rows = departments.map(([name]) => {
    const item = departmentState.get(name);
    if (!item) return `<tr><td>${name}</td><td colspan="5">Sin datos disponibles</td></tr>`;
    return `<tr><td>${name}</td><td>${weatherText(item.code)}</td><td>${Math.round(item.temperature)} °C</td><td>${Math.round(item.humidity)}%</td><td>${Math.round(item.rain)} mm</td><td>${Math.round(item.wind)} km/h</td></tr>`;
  }).join('');
  document.querySelector('#climate-data-rows').innerHTML = rows;
  document.querySelector('#climate-map').innerHTML = departments.map(([name]) => {
    const item = departmentState.get(name);
    if (!item) return `<div class="climate-map-tile"><b>${name}</b><span>Sin datos</span></div>`;
    return `<div class="climate-map-tile ${item.rain >= 10 ? 'rainy' : ''}"><b>${name}</b><span>${Math.round(item.temperature)}°C · ${Math.round(item.rainProbability)}% lluvia</span></div>`;
  }).join('');
  const signals = departments.flatMap(([name]) => {
    const item = departmentState.get(name);
    if (!item) return [];
    if (item.code >= 95 || item.rain >= 30) return [{name,level:'high',title:'Lluvia intensa o tormenta modelada',detail:`${name}: ${Math.round(item.rain)} mm estimados hoy.`}];
    if (item.rainProbability >= 70) return [{name,level:'medium',title:'Probabilidad alta de lluvia',detail:`${name}: ${Math.round(item.rainProbability)}% de probabilidad máxima para hoy.`}];
    return [];
  });
  document.querySelector('#climate-alert-count').textContent = signals.length ? `${signals.length} SEÑALES ORIENTATIVAS` : 'SIN SEÑALES ELEVADAS';
  document.querySelector('#climate-alerts').innerHTML = signals.length ? signals.map(signal=>`<article class="climate-alert ${signal.level}"><span>${signal.level==='high'?'!':'•'}</span><div><b>${signal.title}</b><p>${signal.detail}</p></div><small>${signal.name}</small></article>`).join('') : '<div class="empty-recordings">No hay señales de lluvia intensa en los datos de referencia consultados.</div>';
  renderDepartmentForecast();
}

function renderDepartmentForecast() {
  const name = departmentSelect.value;
  const item = departmentState.get(name);
  if (!item) { document.querySelector('#department-forecast').innerHTML='<p class="empty-recordings">Todavía no hay datos para esta región.</p>'; return; }
  document.querySelector('#department-forecast').innerHTML = `<div class="department-current"><span>AHORA · ${name.toLocaleUpperCase('es-NI')}</span><strong>${Math.round(item.temperature)}°C</strong><b>${weatherText(item.code)}</b><small>Humedad ${Math.round(item.humidity)}% · viento ${Math.round(item.wind)} km/h · lluvia hoy ${item.rain.toFixed(1)} mm</small></div><div class="department-days">${item.days.map(day=>`<article><span>${formatDay(day.date)}</span><b>${weatherText(day.code)}</b><strong>${Math.round(day.max)}° / ${Math.round(day.min)}°</strong><small>Prob. lluvia ${Math.round(day.rain)}%</small></article>`).join('')}</div>`;
}
departmentSelect.addEventListener('change',renderDepartmentForecast);

async function refreshDepartmentWeather(force = false) {
  if (nationalWeatherBusy) { if (force) nationalWeatherPending = true; return; }
  if (!force && Date.now() - nationalWeatherUpdatedAt < nationalWeatherRefreshMs) return;
  nationalWeatherBusy = true;
  const refreshButton = document.querySelector('#refresh-national-weather');
  const updatedLabel = document.querySelector('#national-weather-updated');
  if (refreshButton) refreshButton.disabled = true;
  if (updatedLabel) updatedLabel.textContent = 'ACTUALIZANDO…';
  const latitudes = departments.map(row=>row[1]).join(',');
  const longitudes = departments.map(row=>row[2]).join(',');
  const query = new URLSearchParams({latitude:latitudes,longitude:longitudes,current:'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',forecast_days:'5',timezone:'America/Managua'});
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`,{cache:'no-store'});
    if(!response.ok) throw new Error('forecast unavailable');
    const result = await response.json();
    const all = Array.isArray(result) ? result : [result];
    all.forEach((data,index)=>{
      const name=departments[index]?.[0]; if(!name || !data.current) return;
      departmentState.set(name,{temperature:data.current.temperature_2m,humidity:data.current.relative_humidity_2m,rain:data.current.precipitation,wind:data.current.wind_speed_10m,code:data.current.weather_code,rainProbability:data.daily.precipitation_probability_max[0]??0,days:data.daily.time.map((date,day)=>({date,code:data.daily.weather_code[day],max:data.daily.temperature_2m_max[day],min:data.daily.temperature_2m_min[day],rain:data.daily.precipitation_probability_max[day]??0}))});
    });
    if (!departmentState.has(departmentSelect.value)) departmentSelect.value='Managua';
    nationalWeatherUpdatedAt = Date.now();
    updatedLabel.textContent=`Actualizado ${new Intl.DateTimeFormat('es-NI',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date())} · modelo meteorológico`;
    renderNationalClimate();
  } catch {
    const previous = nationalWeatherUpdatedAt ? ` · datos anteriores ${new Intl.DateTimeFormat('es-NI',{hour:'2-digit',minute:'2-digit'}).format(new Date(nationalWeatherUpdatedAt))}` : '';
    updatedLabel.textContent=`Sin conexión${previous}`;
    if (!departmentState.size) {
      document.querySelector('#climate-data-rows').innerHTML='<tr><td colspan="6">No se pudo conectar al servicio meteorológico. Intenta de nuevo o consulta INETER.</td></tr>';
      document.querySelector('#department-forecast').innerHTML='<p class="empty-recordings">No hay conexión con el proveedor de datos meteorológicos.</p>';
      document.querySelector('#climate-map').innerHTML='<p class="empty-recordings">No se pudo actualizar la vista regional.</p>';
      document.querySelector('#climate-alerts').innerHTML='<p class="empty-recordings">No se pudo analizar el pronóstico actual.</p>';
    }
  } finally {
    nationalWeatherBusy = false;
    if (refreshButton) refreshButton.disabled = false;
    if (nationalWeatherPending) { nationalWeatherPending = false; queueMicrotask(() => refreshDepartmentWeather(true)); }
  }
}
document.querySelector('#refresh-national-weather')?.addEventListener('click', () => refreshDepartmentWeather(true));
window.addEventListener('online', () => refreshDepartmentWeather(true));
window.addEventListener('focus', () => refreshDepartmentWeather());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDepartmentWeather(); });
refreshDepartmentWeather(true);
setInterval(() => refreshDepartmentWeather(),nationalWeatherRefreshMs);
