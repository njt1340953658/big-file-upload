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
    message.error(error.message);
    throw new Error(err)
  }
}

/**
 * currentFile 当前选中的源文件
 * fileChunkData 文件切分之后的chunk数组
 * uploadProgress 文件上传的总进度
 * hashProgress 获取文件hash值的进度
 * currentController 当前要取消请求的controller
 * startIndex 断点续传，文件开始上传的索引
 * */
class Upload {
  constructor(options = {}) {
    const { SIZE, currentFile, httpApi, mergeApi, checkApi, retryMaxCount, retryDelay } = options
    this.SIZE = SIZE;
    this.options = options
    this.currentFile = currentFile;
    this.curFileHash = null;
    this.hashProgress = 0;
    this.uploadProgress = 0;
    this.startIndex = 0;
    this.fileChunkData = []
    this.currentController = {}
    this.retryMaxCount = retryMaxCount || 3
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
    this.curFileHash = hashRes.hash
    if (!hashRes.code) return message.error(hashRes.message);
    const res = await request(this.uploadApi.checkApi, { hash: hashRes.hash }, 'get', { closeMessage: true });
    if (res?.code === 1) {
      this.uploadProgress = 100
      this.handleCallBack(callBack)
      return message.success("文件秒传，上传成功！")
    }
    if (res?.code === 2) {
      const { index } = res;
      this.startIndex = index;
    }
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
  uploadChunkRequest = async (chunk, hash, i, callBack, retryMaxCount = 0) => {
    const formData = new FormData();
    formData.append("chunk", chunk);
    formData.append("hash", hash);
    formData.append("filename", this.currentFile.name);

    // 创建取消请求的controller
    const controller = new AbortController();
    this.currentController = { controller, hash };

    try {
      const res = await axios.post(this.uploadApi.httpApi, formData, {
        onUploadProgress: (progressEvent) => {
          this.uploadProgress = parseInt(((progressEvent.loaded / progressEvent.total) / (this.fileChunkData.length - this.startIndex)) * 100 || 0);
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
      if (retryMaxCount < this.retryMaxCount) {
        console.log(`Error occurred during upload. Retrying... (${retryMaxCount + 1}/3)`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay)); // 等待一段时间再进行重试
        return await this.uploadChunkRequest(chunk, hash, i, callBack, retryMaxCount + 1)
      } else {
        throw new Error(`Failed to upload after ${retryMaxCount} attempts`);
      }
    }
  };


  // 合并chunk
  mergeChunk = async (hash, filename) => {
    const res = await request(this.uploadApi.mergeApi, { hash, filename }, 'post');
    if (res.code === 1) {
      message.success(res.message);
    }
  };

  // 暂停上传/取消当前分片请求
  handleStopUpload = () => {
    this.currentController.controller?.abort();
  };

  // 断点续传
  handleStartUpload = async (callback) => {
    let flag = true;
    const { hash } = this.currentController;
    if (!hash) return this.handleUpload(callback);
    const [fileHash, index] = hash.split("-");
    for (let i = index; i < this.fileChunkData.length; i++) {
      const { chunk, hash } = this.fileChunkData[i];
      flag = await this.uploadChunkRequest(chunk, hash, i, callback);
    }
    if (flag) this.mergeChunk(fileHash, this.currentFile.name);
  };

  // 处理进度信息
  handleCallBack = (callBack) => {
    return callBack({
      name: this.currentFile.name,
      curFileHash: this.curFileHash,
      hashProgress: this.hashProgress,
      uploadProgress: this.uploadProgress,
    })
  }
}

class FileUpload {
  constructor(options = {}) {
    const { filesList = [], httpApi, mergeApi, checkApi } = options
    this.httpApi = httpApi
    this.mergeApi = mergeApi
    this.checkApi = checkApi
    this.filesList = []
    filesList.forEach((file) => {
      this.filesList.push(new Upload({
        httpApi,
        mergeApi,
        checkApi,
        SIZE: options.SIZE,
        currentFile: file,
      }))
    })
    this.currentUploadIndex = -1
  }

  handleUpload = async (callBack) => {
    try {
      while (this.currentUploadIndex < this.filesList.length - 1) {
        this.currentUploadIndex++
        await this.filesList[this.currentUploadIndex].handleUpload(callBack)
      }
    } catch (error) {
      console.error( '上传队列出错：' + error)
    }
  }

  handleStopUpload = () => {
    this.filesList.forEach((uploadInstance) => {
      uploadInstance.handleStopUpload()
    })
  }

  handleStartUpload = (callBack) => {
    this.filesList.forEach((uploadInstance) => {
      uploadInstance.handleStartUpload(callBack)
    })
  }
}

export default FileUpload