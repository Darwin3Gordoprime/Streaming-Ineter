const climateSelect = document.querySelector('#home-municipality');
let climateRequestId = 0;
let homeClimateBusy = false;
let homeClimatePending = false;
let homeClimateUpdatedAt = 0;
const climateRefreshMs = 15 * 60 * 1000;

function climateTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat('es-NI', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function climateDescription(code) {
  if (code >= 95) return ['Tormenta', '⛈'];
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return ['Lluvia', '🌧'];
  if (code >= 45 && code <= 48) return ['Neblina', '🌫'];
  if (code === 0) return ['Despejado', '☀'];
  if (code <= 2) return ['Parcialmente nublado', '⛅'];
  return ['Nublado', '☁'];
}

function renderFiveDayForecast(daily) {
  const days = daily.time.map((date, index) => {
    const dayName = index === 0 ? 'Hoy' : new Intl.DateTimeFormat('es-NI', { weekday: 'short' }).format(new Date(`${date}T12:00:00`));
    const [label, icon] = climateDescription(daily.weather_code[index]);
    return `<div class="home-forecast-day"><span>${dayName}</span><i aria-label="${label}">${icon}</i><strong>${Math.round(daily.temperature_2m_max[index])}° / ${Math.round(daily.temperature_2m_min[index])}°</strong><small>☔ ${Math.round(daily.precipitation_probability_max[index] ?? 0)}% lluvia</small></div>`;
  });
  document.querySelector('#home-forecast-days').innerHTML = days.join('');
}

async function refreshHomeClimate(force = false) {
  if (homeClimateBusy) { if (force) homeClimatePending = true; return; }
  if (!force && Date.now() - homeClimateUpdatedAt < climateRefreshMs) return;
  homeClimateBusy = true;
  const refreshButton = document.querySelector('#refresh-home-climate');
  const updatedLabel = document.querySelector('#home-weather-updated');
  if (refreshButton) refreshButton.disabled = true;
  if (updatedLabel) updatedLabel.textContent = 'Actualizando condiciones…';
  const requestId = ++climateRequestId;
  const municipality = climateSelect.value;
  localStorage.setItem('ineterHomeMunicipality', municipality);
  try {
    const placeResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(municipality)}&count=10&language=es&format=json`, { cache: 'no-store' });
    if (!placeResponse.ok) throw new Error('Geocodificación no disponible');
    const places = (await placeResponse.json()).results || [];
    const place = places.find(item => item.country_code === 'NI') || places[0];
    if (!place) throw new Error('No se encontró el municipio');
    const query = new URLSearchParams({ latitude: place.latitude, longitude: place.longitude, current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m', hourly: 'precipitation_probability', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max', forecast_days: '5', timezone: 'America/Managua' });
    const forecastResponse = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { cache: 'no-store' });
    if (!forecastResponse.ok) throw new Error('Pronóstico no disponible');
    const data = await forecastResponse.json();
    if (requestId !== climateRequestId) return;
    const current = data.current;
    const [condition, icon] = climateDescription(current.weather_code);
    const hourIndex = data.hourly.time.indexOf(current.time.slice(0, 13));
    document.querySelector('#home-weather-place').textContent = `${place.name}${place.admin1 ? `, ${place.admin1}` : ''}`;
    document.querySelector('#home-forecast-place').textContent = municipality;
    document.querySelector('#home-weather-icon').textContent = icon;
    document.querySelector('#home-temperature').textContent = `${Math.round(current.temperature_2m)}°C`;
    document.querySelector('#home-weather-condition').textContent = condition;
    document.querySelector('#home-humidity').textContent = `${Math.round(current.relative_humidity_2m)}%`;
    document.querySelector('#home-rain').textContent = `${Math.round(data.hourly.precipitation_probability[hourIndex] ?? 0)}%`;
    document.querySelector('#home-wind').textContent = `${Math.round(current.wind_speed_10m)} km/h`;
    document.querySelector('#home-feels-like').textContent = `${Math.round(current.apparent_temperature)}°C`;
    renderFiveDayForecast(data.daily);
    homeClimateUpdatedAt = Date.now();
    if (updatedLabel) updatedLabel.textContent = `Actualizado ${climateTimeLabel()} · modelo meteorológico`;
  } catch {
    if (requestId !== climateRequestId) return;
    const previous = homeClimateUpdatedAt ? ` · último dato ${climateTimeLabel(new Date(homeClimateUpdatedAt))}` : '';
    if (updatedLabel) updatedLabel.textContent = `Sin conexión${previous}`;
    if (!homeClimateUpdatedAt) {
      document.querySelector('#home-weather-condition').textContent = 'No se pudieron actualizar las condiciones';
      document.querySelector('#home-forecast-days').innerHTML = '<p class="empty-recordings">Revisa tu conexión o consulta el pronóstico oficial de INETER.</p>';
    }
  } finally {
    homeClimateBusy = false;
    if (refreshButton) refreshButton.disabled = false;
    if (homeClimatePending) { homeClimatePending = false; queueMicrotask(() => refreshHomeClimate(true)); }
  }
}

const savedMunicipality = localStorage.getItem('ineterHomeMunicipality');
if (savedMunicipality && [...climateSelect.options].some(option => option.value === savedMunicipality)) climateSelect.value = savedMunicipality;
climateSelect.addEventListener('change', () => refreshHomeClimate(true));
document.querySelector('#refresh-home-climate')?.addEventListener('click', () => refreshHomeClimate(true));
window.addEventListener('online', () => refreshHomeClimate(true));
window.addEventListener('focus', () => refreshHomeClimate());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshHomeClimate(); });
refreshHomeClimate(true);
setInterval(() => refreshHomeClimate(), climateRefreshMs);
