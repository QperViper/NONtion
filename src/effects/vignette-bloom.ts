import parameters from './vignette-bloom.preset.json' with { type: 'json' };
import type { AsciiParameters } from './ascii-types.ts';

// The user's recipe is kept verbatim as data. The renderer is a reconstruction
// of its documented pipeline, not the gated source code of 21st.dev.
export const vignetteBloomParameters = parameters as AsciiParameters;
export const vignetteBloomSource = '/ascii-editor/demos/generated/ref-008.webp';
export const vignetteBloomReference = 'https://21st.dev/community/ascii/vignette-bloom-e05cb032-35be-4bcd-999b-cbf5b1588bac';
