import { getGrantedOrigins } from './chrome-api.js';

export async function readGrantedOrigins() {
  try {
    return await getGrantedOrigins();
  } catch (error) {
    console.error('Could not read granted site access.', error);
    return null;
  }
}
