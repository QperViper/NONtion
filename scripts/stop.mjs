// Detiene nontion (el vigilante y la API que inició el lanzador).
import { stopApi } from './api-process.mjs';

const stopped = await stopApi();
console.log(stopped.length ? `nontion detenido (pid ${stopped.join(', ')}).` : 'nontion no estaba en marcha (o lo inició "npm run dev").');
