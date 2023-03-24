<template>
  <div style="display: flex; justify-content: space-between">
    <Input multiple id="file" type="file" @change="onChange" style="width: 300px" />
    <div>
      <Button @click="handleUpload" type="primary">点击上传</Button>

      <Button style="margin-left: 20px" @click="handleStopUpload" type="primary">暂停上传</Button>
      <Button style="margin-left: 20px" @click="handleStartUpload" type="primary">继续上传</Button>
    </div>
  </div>
  <div v-if="hashProgress && hashProgress !== 100" style="display: flex; height: 80px; align-items: center;">
    <Space style="width: 80px; display: block;">
      <Spin tip="文件校验中" size="small">
        <div className="content" />
      </Spin>
    </Space>
    <div style="margin-left: 12px;">{{ hashProgress + '%' }}</div>
  </div>
  <div>待上传文件：{{ dataSource.length - uploadFinishedNum }}</div>
  <a-table :dataSource="dataSource" :columns="columns">
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'progress'">
        <a-progress :percent="record.progress" /></template>
    </template>
  </a-table>
</template>

<script setup>
import { ref } from "vue";
import FileUpload from './utils/upload'
import { Button, Input, Space, Spin } from "ant-design-vue";

// 切片大小
const SIZE = 50 * 1024 * 1024;

const options = {
  SIZE,
  filesList: [],
  httpApi: "/api/upload",
  mergeApi: "/api/merge",
  checkApi: "/api/checkFileIsUploaded",
}

// table配置
const columns = [
  {
    title: "名称",
    dataIndex: "name",
    key: "name",
  },
  {
    title: "校验hash",
    dataIndex: "hash",
    key: "hash",
  },
  {
    title: "进度",
    dataIndex: "progress",
    key: "progress",
  },
];

//  table数据源
const dataSource = ref([]);

// 获取文件hash值的进度
const hashProgress = ref(0);

// 初始化上传实例对象
const uploadInstance = ref({})

// 上传完成的文件数量
const uploadFinishedNum = ref(0)

const onChange = (e) => {
  const filesList = [...e.target.files];
  uploadInstance.value = new FileUpload({ ...options, filesList })
  filesList.forEach(item => dataSource.value.push({ name: item.name }))
};

const handleUpload = () => {
  uploadInstance.value.upload?.(updateDataSource);
}

const handleStopUpload = () => {
  uploadInstance.value.stopUpload?.()
}

const handleStartUpload = () => {
  uploadInstance.value.startUpload?.(updateDataSource)
}

const updateDataSource = (files) => {
  hashProgress.value = files.hashProgress || 0
  dataSource.value.map((item, fileIndex) => {
    if (item.name === files.name) {
      dataSource.value[fileIndex].hash = files.curFileHash
      dataSource.value[fileIndex].progress = files.uploadProgress
      if (files.uploadProgress === 100) {
        uploadFinishedNum.value += 1
      }
    }
  })
  
}
</script>