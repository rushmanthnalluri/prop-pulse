/**
 * Split-size derivation for the insights surfaces. GET /model/info carries no
 * split sizes, but the classification champion's confusion matrices are real
 * counts on the validation and sealed-test splits, so their totals ARE the
 * split sizes (CONTRACT §4: val 338 (2009), sealed test 175 (2010)).
 */

/**
 * Sum a 2×2 confusion matrix defensively. Accepts the API's object shape
 * ({ tn, fp, fn, tp }) or a nested-array form ([[tn, fp], [fn, tp]]); returns
 * the total count, or null when the matrix is missing or any count is
 * non-finite — callers render without the number rather than a wrong one.
 */
export function confusionTotal(matrix) {
  const counts = Array.isArray(matrix)
    ? matrix.flat()
    : [matrix?.tn, matrix?.fp, matrix?.fn, matrix?.tp]
  if (counts.length !== 4) return null
  const nums = counts.map(Number)
  if (!nums.every(Number.isFinite)) return null
  return nums.reduce((sum, n) => sum + n, 0)
}
