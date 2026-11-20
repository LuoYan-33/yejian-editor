const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' };

/** 只识别编辑器支持的内嵌位图，其他地址继续走原有的路径规则。 */
function isEmbeddedImage(address) {
  return /^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,/i.test(address);
}

module.exports = { types, isEmbeddedImage };
