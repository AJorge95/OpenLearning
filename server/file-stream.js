import fs from 'node:fs';

export function streamFileToResponse(filePath, response, next, options) {
  const stream = fs.createReadStream(filePath, options);
  const removeCloseListener = () => response.off('close', handleResponseClose);
  const handleResponseClose = () => {
    if (!response.writableFinished) stream.destroy();
  };

  response.once('close', handleResponseClose);
  stream.once('close', removeCloseListener);
  stream.once('error', (error) => {
    removeCloseListener();
    next(error);
  });
  stream.pipe(response);
  return stream;
}
