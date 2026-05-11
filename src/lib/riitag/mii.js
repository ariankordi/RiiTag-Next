import FormData from 'form-data';
import logger from '@/lib/logger';
import NnidResolver from '../utils/NnidResolver.mjs';

const CMOC_BASE_URL = 'https://miicontestp.wii.rc24.xyz';

// Basis-URL der Mii-Renderer-API, vgl. Swagger:
// https://mii-unsecure.ariankordi.net/swagger/index.html
const MII_RENDERER_BASE_URL = 'https://mii-unsecure.ariankordi.net';

export async function getMiiHexDataFromCMOC(entryNo) {
  const cleanedEntryNo = entryNo.replaceAll('-', '');
  if (cleanedEntryNo.length !== 12 || Number.isNaN(cleanedEntryNo) === true) {
    throw new Error(
      'Entry Number must be exactly 12 numbers long (ignoring dashes).'
    );
  }

  const cmocUrl = `${CMOC_BASE_URL}/cgi-bin/studio.cgi`;
  const formData = new FormData();
  formData.append('platform', 'wii');
  formData.append('id', cleanedEntryNo);

  let response;
  logger.info(`Getting CMOC entry no. ${cleanedEntryNo}`);
  try {
    response = await fetch(cmocUrl, { method: 'POST', body: formData });
  } catch (error) {
    throw new Error(
      `Error while fetching Mii from CMOC (Entry No. ${cleanedEntryNo}): ${error.message}`
    );
  }

  if (response.status !== 200) {
    throw new Error('Mii entry not found.');
  }

  const json = await response.json();

  if (!json.mii) {
    throw new Error('Got invalid Mii data.', json);
  }

  return json.mii;
}

export async function getMiiFromQR(data) {
  const cmocUrl = `${CMOC_BASE_URL}/cgi-bin/studio.cgi`;
  const formData = new FormData();
  formData.append('platform', 'gen2');
  formData.append('data', data);

  let response;
  logger.info(`Sending QR-Code Mii`);
  try {
    response = await fetch(cmocUrl, {
      method: 'POST',
      headers: formData.getHeaders(),
      body: formData,
    });
  } catch (error) {
    throw new Error(`Error while fetching Mii from QR Code: ${error.message}`);
  }

  if (response.status !== 200) {
    throw new Error('There was an error while loading the Mii.');
  }

  const json = await response.json();

  if (!json.mii) {
    throw new Error('Got invalid Mii data.', json);
  }

  return json.mii;
}

export async function getMiiFromHexData(miiData) {
  // 1) Spezieller Fall: 3DS / QR-Code Mii Studio URL-Daten (historisches Verhalten)
  // Diese Daten sind 94 Zeichen lang und werden direkt an Nintendos Studio-Endpoint
  // weitergereicht.
  if (miiData.length === 94) {
    const url = `https://studio.mii.nintendo.com/miis/image.png?data=${miiData}&type=face&width=512&instanceCount=1`;
    logger.info(`Downloading QR Mii from ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Image download failed, got HTTP error ${response.status} from Nintendo: ${url}`
      );
    }
    return response.body;
  }

  const hexRegex = /^[\dA-Fa-f]+$/;

  // 2) Alte Wii-/CMOC-/MAE-Miis: reines Hex → RC24-Renderer verwenden
  if (hexRegex.test(miiData)) {
    const url = `${CMOC_BASE_URL}/cgi-bin/render.cgi?data=${miiData}`;
    logger.info(`Downloading Wii Mii from ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Image download failed, got HTTP error ${response.status} from Nintendo: ${url}`
      );
    }
    return response.body;
  }

  // 3) Alles andere behandeln wir als "data" für den neuen Mii Renderer,
  // z.B. Base64 aus /mii_data/{nnid}.
  const url = `${MII_RENDERER_BASE_URL}/miis/image.png?data=${encodeURIComponent(
    miiData
  )}&type=face&shaderType=wiiu_blinn`;
  logger.info(`Downloading Mii from Mii Renderer: ${url}`);
  const response = await fetch(url, {
    headers: {
      accept: 'image/png',
    },
  });
  if (!response.ok) {
    throw new Error(
      `Image download failed, got HTTP error ${response.status}} from Mii Renderer: ${url}`
    );
  }

  return response.body;
}

export async function getMiiHexDataFromNNID(nnid) {
  // Nintendo Network ID – Standard-API (api_id wird nicht gesetzt).
  const url = `${MII_RENDERER_BASE_URL}/mii_data/${encodeURIComponent(id)}`;

  logger.info(`Calling Mii Renderer /mii_data endpoint: ${url}`);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Mii Renderer API error ${response.status} for ${url}`
    );
  }

  const json = await response.json();

  if (!json.data) {
    throw new Error('Got invalid Mii data from Mii Renderer API.');
  }

  // Die API liefert Base64-Daten im Feld "data". Diese speichern wir
  // unverändert, damit sie direkt an /miis/image.png?data=... weitergegeben
  // werden können.
  return json.data;
}

export async function getMiiHexDataFromPNID(pnid) {
  // For Pretendo Network ID, this can be obtained directly with NnidResolver.
  const pid = await NnidResolver.pidFromUserId(pnid);
  const response = await NnidResolver.miiFromPid(pid);
  return response.miiData; // Return Base64 Mii data.
}

export async function getMiiHexDataFromDataOrUrl(input) {
  // Freies Eingabefeld: versuche zunächst, eine Mii Studio URL zu parsen,
  // ansonsten direkt Hex- oder Base64-Daten zu übernehmen.
  if (!input) {
    throw new Error('Empty Mii data or URL');
  }

  // Versuche, es als URL zu interpretieren (z.B. Mii Studio URL mit ?data=...).
  try {
    const parsedUrl = new URL(input);
    const dataParameter = parsedUrl.searchParams.get('data');
    if (dataParameter) {
      return dataParameter;
    }
  } catch {
    // Kein gültiger URL-String, weiter unten als Rohdaten behandeln.
  }

  const trimmed = input.trim();
  const hexRegex = /^[\dA-Fa-f]+$/;

  if (hexRegex.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  // Wenn es kein Hex ist, lassen wir die Daten unverändert durch – sie werden
  // später als "data" an den Mii Renderer übergeben.
  return trimmed;
}
