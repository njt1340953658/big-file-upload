import axios from "axios";
import { createFileChunk, getHash } from './getHash'
import { message } from "ant-design-vue";

const request = async (httpApi, params = {}, method = 'get') => {
  const methodParmas = method.toLocaleLowerCase() === 'get' ? { params: {...params} } : params
  try {
    const res = await axios[method](httpApi, methodParmas)
    if (res.data.code === 1) return res.data
    message.error(res.data.message);
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
    const hashRes = await getHash(this.currentFile, this.SIZE, callBack);
    if (!hashRes.code) return message.error(hashRes.message);
    const res = await request(this.uploadApi.checkApi, { hash: hashRes.hash });
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
    this.uploadChunk(hashRes.hash);
  }


  // 上传文件
  uploadChunk = async (hash) => {
    let flag = true;
    for (let i = this.startIndex; i < this.fileChunkList.length; i++) {
      let { chunk, hash } = this.fileChunkList[i];
      flag = await this.uploadChunkRequest(chunk, hash, i);
    }
    if (flag) {
      mergeChunk(hash, this.currentFile.name); // 全部分片上传完成，发送请求告诉服务器合并
    }
  };

  // 上传文件请求
  uploadChunkRequest = async (chunk, hash, i) => {
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
        onUploadProgress: function (progressEvent) {
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
    if (res.data.code === 1) {
      message.success(res.data.message);
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
}

export default Upload