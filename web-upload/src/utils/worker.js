import SparkMD5 from "spark-md5";

self.addEventListener("message", (event) => {
  const { file, SIZE } = event.data;

  const blobSlice =
    File.prototype.slice ||
    File.prototype.mozSlice ||
    File.prototype.webkitSlice;

  const chunkSize = SIZE;

  const chunks = Math.ceil(file.size / chunkSize);

  let currentChunk = 0;

  const spark = new SparkMD5.ArrayBuffer();

  const fileReader = new FileReader();

  function loadNext() {
    var start = currentChunk * chunkSize,
      end = start + chunkSize >= file.size ? file.size : start + chunkSize;
    fileReader.readAsArrayBuffer(blobSlice.call(file, start, end));
  }

  fileReader.onload = function (e) {
    const progress = ((currentChunk + 1) / chunks) * 100;
    self.postMessage({ type: "progress", progress });
    spark.append(e.target.result); // Append array buffer
    currentChunk++;

    if (currentChunk < chunks) {
      loadNext();
    } else {
      const hash = spark.end();
      self.postMessage({ type: "result", code: 1, hash });
    }
  };

  fileReader.onerror = function () {
    console.error("oops, something went wrong.");
    self.postMessage({
      type: "result",
      code: 0,
      message: "oops, something went wrong.",
    });
  };

  loadNext();
});
