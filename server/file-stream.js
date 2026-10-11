import fs from 'node:fs';

export function streamFileToResponse(filePath, response, next, options) {
  const stream = fs.createReadStream(filePath, options);
  const removeCloseListener = () => response.off('close', handleResponseClose);
  const handleResponseClose = () => {
    if (!response.writableFinished) stream.destroy();
  };

  stream.once('close', removeCloseListener);
  stream.once('error', (error) => {
    removeCloseListener();
    next(error);
  });
  if (response.destroyed || response.writableEnded) {
    stream.destroy();
    return stream;
  }
  response.once('close', handleResponseClose);
  stream.pipe(response);
  return stream;
}
