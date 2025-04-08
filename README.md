# example
```
function requestInterceptor(){
  return await axiosManager.attachAbortController(config);
}
function responseInterceptor(){
  axiosManager.onResponse(response);
}
function responseErrorInterceptor(){
  if (config.signal?.aborted) {
        const data = axiosManager.getReturnData(config);
        return { data: JSON.parse(data ?? '') };
    }
}
```
