import MyWorker from "./worker.js?worker";

export const getHash = (file, SIZE, callback) => {

  const worker = new MyWorker();

  worker.postMessage({ file, SIZE });

  const promise = new Promise((resolve) => {
    worker.onmessage = (event) => {
      const data = event.data;
      switch (data.type) {
        case "progress":
          callback(data.progress);
          break;
        case "result":
          worker.terminate();
          callback(100);
          resolve(data);
          break;
        default:
          resolve(data);
          break;
      }
    };
  });
  return promise;
};

// 文件分片
export const createFileChunk = (file, size) => {
  const fileChunkList = [];
  let current = 0;
  while (current < file.size) {
    fileChunkList.push({ file: file.slice(current, current + size) });
    current += size;
  }
  return fileChunkList;
};
