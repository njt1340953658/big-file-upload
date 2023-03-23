<template>
  <div style="display: flex; justify-content: space-between">
    <Input multiple id="file" type="file" @change="onChange" style="width: 300px" />
    <div>
      <Button @click="handleUpload" type="primary">点击上传</Button>

      <Button style="margin-left: 20px" @click="handleStopUpload" type="primary">暂停上传</Button>
      <Button style="margin-left: 20px" @click="handleStartUpload" type="primary">继续上传</Button>
    </div>
  </div>
  校验文件进度
  <a-progress v-if="hashProgress > 0" :percent="hashProgress" />
  <a-progress v-if="fileChunkData.length > 0" :percent="totalProgress" />
  <a-table :dataSource="dataSource" :columns="columns">
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'progress'">
        <a-progress :percent="record.progress" /></template>
    </template>
  </a-table>
</template>

<script setup>
import { Button, Input } from "ant-design-vue";
import { ref, computed, reactive } from "vue";
import Upload from './utils/upload'

// 切片大小
const SIZE = 50 * 1024 * 1024;

// table配置
const columns = [
  {
    title: "分片名",
    dataIndex: "hash",
    key: "hash",
  },
  {
    title: "进度",
    dataIndex: "progress",
    key: "progress",
  },
];

const upload = new Upload({
  SIZE,
  currentFile: null,
  httpApi: "/api/upload",
  mergeApi: "/api/merge",
  checkApi: "/api/checkFileIsUploaded",
})

const uploader = reactive(upload)

// 文件切分之后的chunk数组
const fileChunkData = ref([]);
//  table数据源
const dataSource = ref([]);
// 文件上传的总进度
const totalProgress = ref(0);
// 获取文件hash值的进度
const hashProgress  = ref(0);

const onChange = (e) => {
  const [file] = e.target.files;
  uploader.currentFile = file
};

const handleUpload = () => {
  uploader.handleUpload((parent) => hashProgress.value = parseInt(parent))
}

const handleStopUpload = () => {
  uploader.handleStopUpload()
}

const handleStartUpload = () => {
  uploader.handleStartUpload()
}


// watch(() => uploader.totalProgress, (value) => {
//   totalProgress.value = value;
// });

// watch(() => uploader.dataSource, (value) => {
//   dataSource.value = value;
// })

// watch(() => uploader.fileChunkData, (value) => {
//   fileChunkData.value = value;
// })
</script>