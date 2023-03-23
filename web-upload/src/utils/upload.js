import axios from "axios";
import { createFileChunk, getHash } from './getHash'
import { message } from "ant-design-vue";

const request = async (httpApi, params = {}, method = 'get', options) => {
  const { closeMessage } = options || {}
  const methodParmas = method.toLocaleLowerCase() === 'get' ? { params: { ...params } } : params
  try {
    const res = await axios[method](httpApi, methodParmas)
    if (res.data.code === 1) return res.data
    closeMessage ? void null : message.error(res.data.message);
  } catch (error) {
    throw new Error(err)
  }
}

/**
 * currentFile 当前选中的源文件
 * fileChunkData 文件切分之后的chunk数组
 * dataSource table数据源
 * uploadFinishedNumber 上传完成的文件数量
 * uploadProgress 文件上传的总进度
 * hashProgress 获取文件hash值的进度
 * currentController 当前要取消请求的controller
 * startIndex 断点续传，文件开始上传的索引
 * */
class Upload {
  constructor(options = {}) {
    const { SIZE, currentFile, httpApi, mergeApi, checkApi, retryCount, retryDelay } = options
    this.SIZE = SIZE;
    this.options = options
    this.hashProgress = 0;
    this.uploadProgress = 0;
    this.startIndex = 0;
    this.dataSource = [];
    this.fileChunkData = []
    this.currentFile = currentFile;
    this.currentController = {}
    this.uploadFinishedNumber = 0
    this.uploadStatus = null;
    this.retryCount = retryCount || 3
    this.retryDelay = retryDelay || 3000
    this.uploadApi = { httpApi, mergeApi, checkApi }
  }

  // 点击上传按钮
  handleUpload = async (callBack) => {
    if (!this.currentFile) return;
    const hashRes = await getHash(this.currentFile, this.SIZE, (progress) => {
      this.hashProgress = parseInt(progress)
      this.handleCallBack(callBack)
    });
    if (!hashRes.code) return message.error(hashRes.message);
    const res = await request(this.uploadApi.checkApi, { hash: hashRes.hash }, 'get', { closeMessage: true });
    if (res?.code === 1) return message.success("上传成功，该文件已经上传过");
    if (res?.code === 2) {
      const { index } = res;
      this.startIndex = index;
      this.dataSource = [];
    }
    this.dataSource = [];
    const fileChunkList = createFileChunk(this.currentFile, this.SIZE);
    this.fileChunkData = fileChunkList.map((fileChunk, index) => ({
      chunk: fileChunk.file,
      hash: hashRes.hash + "-" + index,
    }));
    // 分片上传
    this.uploadChunk(hashRes.hash, callBack);
  }

  // 上传文件
  uploadChunk = async (hash, callBack) => {
    let flag = true;
    for (let i = this.startIndex; i < this.fileChunkData.length; i++) {
      const { chunk, hash } = this.fileChunkData[i];
      flag = await this.uploadChunkRequest(chunk, hash, i, callBack);
    }
    if (flag) {
      this.mergeChunk(hash, this.currentFile.name); // 所有分片上传完成，发送请求告诉服务器合并
    }
  };

 // 上传文件请求
  uploadChunkRequest = async (chunk, hash, i, callBack, retryCount = 0) => {
    const formData = new FormData();
    formData.append("chunk", chunk);
    formData.append("hash", hash);
    formData.append("filename", this.currentFile.name);

    this.dataSource.push({ hash: hash, progress: 0, key: i, finished: false });

    // 创建取消请求的controller
    const controller = new AbortController();
    this.currentController = { controller, hash };

    try {
      const res = await axios.post(this.uploadApi.httpApi, formData, {
        onUploadProgress: (progressEvent) => {
          const progressIndex = this.dataSource.length ? this.dataSource.length - 1 : 0;
          const progress = ((progressEvent.loaded / progressEvent.total) * 100) | 0;
          this.dataSource[progressIndex].progress = progress;
          this.uploadProgress = parseInt(((this.uploadFinishedNumber + progressEvent.loaded / progressEvent.total) / (this.fileChunkData.length - this.startIndex)) * 100 || 0);
          if (progress === 100) {
            this.dataSource[progressIndex].finished = true;
            this.uploadFinishedNumber += 1;
          }
        },
        signal: controller.signal,
      });

      this.handleCallBack(callBack)

      if (res.data.code === 0) return false;
      else return true;
    } catch (error) {
      if (axios.isCancel(error)) {
        throw new Error('Upload cancelled');
      }
      if (retryCount < this.retryCount) {
        console.log(`Error occurred during upload. Retrying... (${retryCount+1}/3)`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay)); // 等待一段时间再进行重试
        return await this.uploadChunkRequest(chunk, hash, i, callBack, retryCount + 1)
      } else {
        this.resetUploadInfo()
        throw new Error(`Failed to upload after ${retryCount} attempts`);
      }
    }
  };


  // 合并chunk
  mergeChunk = async (hash, filename) => {
    const res = await request(this.uploadApi.mergeApi, { hash, filename }, 'post');
    if (res.code === 1) {
      this.uploadStatus = 'success'
      message.success(res.message);
      this.resetUploadInfo()
    }
    this.uploadStatus = 'error'
  };

  // 暂停上传/取消当前分片请求
  handleStopUpload = () => {
    this.currentController.controller?.abort();
  };

  // 断点续传
  handleStartUpload = async (callback) => {
    let flag = true;
    const { hash } = this.currentController;
    if (!hash) return this.handleUpload();
    const [fileHash, index] = hash.split("-");
    this.dataSource.pop();
    for (let i = index; i < this.fileChunkData.length; i++) {
      const { chunk, hash } = this.fileChunkData[i];
      flag = await this.uploadChunkRequest(chunk, hash, i, callback);
    }
    if (flag) this.mergeChunk(fileHash, this.currentFile.name);
  };

  // 重置初始值
  resetUploadInfo = () => {
    this.hashProgress = 0;
    this.uploadProgress = 0;
    this.startIndex = 0;
    this.dataSource = [];
    this.fileChunkData = []
    this.currentController = {}
    this.uploadFinishedNumber = 0
    this.uploadStatus = null
    this.retryCount = this.options.retryCount || 3
    this.retryDelay = this.options.retryDelay ||  3000
  }

  // 处理进度信息
  handleCallBack = (callBack) => {
    return callBack({ dataSource: this.dataSource, hashProgress: this.hashProgress, uploadProgress: this.uploadProgress, uploadStatus: this.uploadStatus })
  }
}

export default Upload