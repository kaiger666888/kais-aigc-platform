// 处理未捕获的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('[未处理的 Promise 拒绝]:', reason);
  console.error('Promise:', promise);
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('[未捕获的异常]:', error);
});
