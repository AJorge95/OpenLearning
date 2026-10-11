import { isImageDimensionWithinLimit } from './image-dimensions.ts';

export const MAX_COURSE_COVER_DIMENSION = 4096;

export function isCourseCoverDimensionAllowed(width: number, height: number) {
  return isImageDimensionWithinLimit(width, height, MAX_COURSE_COVER_DIMENSION);
}
