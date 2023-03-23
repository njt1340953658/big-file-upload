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
 * totalProgress 文件上传的总进度
 * hashProgress 获取文件hash值的进度
 * currentController 当前要取消请求的controller
 * startIndex 断点续传，文件开始上传的索引
 * */
class Upload {
  constructor(options = {}) {
    const { SIZE, currentFile, httpApi, mergeApi, checkApi } = options
    this.SIZE = SIZE;
    this.hashProgress = 0;
    this.totalProgress = 0;
    this.startIndex = 0;
    this.dataSource = [];
    this.fileChunkData = []
    this.currentFile = currentFile;
    this.currentController = {}
    this.uploadFinishedNumber = 0
    // this.token = Cookies.get('token')
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
    const maxRetries = 3; // 最大重试次数
    let retryCount = 0;
    for (let i = this.startIndex; i < this.fileChunkData.length; i++) {
      const { chunk, hash } = this.fileChunkData[i];
      while (retryCount < maxRetries) {
        try {
          flag = await this.uploadChunkRequest(chunk, hash, i, callBack);
          break; // 如果上传成功，则跳出 while 循环
        } catch (error) {
          console.log("上传分片失败。正在进行第", retryCount + 1, "次重试...", error);
          retryCount++;
        }
      }
      if (!flag) {
        message.error('上传失败：多次上传分片失败，放弃上传。');
        break;
      } else {
        retryCount = 0; // 重置重试次数，为下一个分片做准备
      }
    }
    if (flag) {
      this.mergeChunk(hash, this.currentFile.name); // 所有分片上传完成，发送请求告诉服务器合并
    }
  };

  // 上传文件请求
  uploadChunkRequest = async (chunk, hash, i, callBack) => {
    const formData = new FormData();
    formData.append("chunk", chunk);
    formData.append("hash", hash);
    formData.append("filename", this.currentFile.name);

    this.dataSource.push({ hash: hash, progress: 0, key: i, finished: false });

    // 创建取消请求的controller
    const controller = new AbortController();
    this.currentController = { controller, hash };

    this.handleCallBack(callBack)

    try {
      const res = await axios.post(this.uploadApi.httpApi, formData, {
        onUploadProgress: (progressEvent) => {
          const progressIndex = this.dataSource.length ? this.dataSource.length - 1 : 0;
          const progress = ((progressEvent.loaded / progressEvent.total) * 100) | 0;
          this.dataSource[progressIndex].progress = progress;
          this.totalProgress = parseInt(((this.uploadFinishedNumber + progressEvent.loaded / progressEvent.total) / (this.fileChunkData.length - this.startIndex)) * 100 || 0);
          if (progress === 100) {
            this.dataSource[progressIndex].finished = true;
            this.uploadFinishedNumber += 1;
          }
        },
        signal: controller.signal,
      });

      this.handleCallBack(callBack)

      if (res.data.code === 0) {
        message.error(`${res.data.hash} 上传失败`);
        return false;
      }
      return true;
    } catch (error) {
      throw new Error(error)
    }
  };


  // 合并chunk
  mergeChunk = async (hash, filename) => {
    const res = await request(this.uploadApi.mergeApi, { hash, filename }, 'post');
    if (res.code === 1) {
      message.success(res.message);
      this.resetUploadInfo()
    }
  };

  // 暂停上传/取消当前分片请求
  handleStopUpload = () => {
    this.currentController.controller?.abort();
  };

  // 断点续传
  handleStartUpload = async () => {
    let flag = true;
    const { hash } = this.currentController;
    if (!hash) return handleUpload();
    const [fileHash, index] = hash.split("-");
    this.dataSource.pop();
    for (let i = index; i < this.fileChunkData.length; i++) {
      const { chunk, hash } = this.fileChunkData[i];
      flag = await this.uploadChunkRequest(chunk, hash, i);
    }
    if (flag) this.mergeChunk(fileHash, this.currentFile.name);
  };

  // 重置初始值
  resetUploadInfo = () => {
    this.hashProgress = 0;
    this.totalProgress = 0;
    this.startIndex = 0;
    this.dataSource = [];
    this.fileChunkData = []
    this.currentController = {}
    this.uploadFinishedNumber = 0
  }

  // 处理进度信息
  handleCallBack = (callBack) => {
    return callBack({ dataSource: this.dataSource, hashProgress: this.hashProgress, totalProgress: this.totalProgress })
  }
}

export default Upload