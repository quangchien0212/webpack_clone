// reading file
const fs = require('fs');
// get path of file
const path = require('path');
// javascript to AST tree
const babylon = require('babylon');
// working with AST tree
const traverse = require('babel-traverse').default;
// transfrom AST
const {transformFromAst} = require('babel-core');

let ID = 0;

function createAsset(filename) {
  const content = fs.readFileSync(filename, 'utf-8');

  // get dependency from AST tree
  const ast = babylon.parse(content, {
    sourceType: 'module',
  });

  const dependencies = [];

  // check node is import type
  traverse(ast, {
    // ImportDeclaration something like import
    ImportDeclaration: ({node}) => {
      dependencies.push(node.source.value);
    },
  });

  const id = ID++;

  // transpiled by babel(it will be read by browser)
  const {code} = transformFromAst(ast, null, {
    presets: ['env'],
  });

  return {
    id,
    filename,
    dependencies,
    code,
  };
}

// Bây giờ chúng ta sẽ thiết lập một biểu đồ quan hệ giữa các dependencies
// Chúng ta sẽ bắt đầu từ file entry.js, đây là điểm đầu vào của project
//
// Tiếp đó, chúng ta sẽ làm tương tự với các dependency của file này (entry.js)
// Từ đó chúng ta có được một mạng quan hệ giữa các dependencies này và thấy rõ
// chúng liên quan với nhau như thế nào. Đây chính là khái niệm về dependency graph
function createGraph(entry) {
  // Start by parsing the entry file.
  const mainAsset = createAsset(entry);
  
  // Chúng ta sẽ tạo ra một queu cho mỗi file mã nguồn, ban đầu thì nó chỉ có cái file entry.js thôi
  const queue = [mainAsset];

  // Chúng ta sẽ dùng vòng lặp `for ... of` để lặp qua cái queue này.
  // Mặc dù lúc mới khởi tạo, queu này chỉ có mỗi 1 file entry thôi,
  // nhưng trong quá trình lặp, mỗi khi tìm thấy 1 file mới chúng ta lại đẩy nó
  // vào trong queu này
  // Vì vậy chúng ta sẽ lặp cho đến khi nào không tìm thấy một dependency nào nữa thì dừng
  for (const asset of queue) {
    // Mỗi file mà chúng ta lặp qua có một danh sách các relative paths được import vào
    // Chúng ta sẽ lặp qua chúng, sử dụng hàm createAsset() đã viết ở trên để tạo ra một dependency graph
    // Lưu nó vào một Object là mapping, để đảm bảo không bị trùng lặp
    asset.mapping = {};

    // Sử dụng thư viện path để xác định thư mục chứa file đang làm việc
    const dirname = path.dirname(asset.filename);

    // Lặp qua relative paths của nó nào
    asset.dependencies.forEach(relativePath => {
      // Hàm `createAsset()` cần phải truyền vào đường dẫn tuyệt đối thì mới đọc được
      const absolutePath = path.join(dirname, relativePath);

      // Đọc nội dung file và lấy danh sách dependencies.
      const child = createAsset(absolutePath);

      // mapping này sẽ lưu quan hệ giữa file này và 1 child dependency của nó
      asset.mapping[relativePath] = child.id;

      // Cuối cùng, đẩy nó vào dependencies queu, để có thể lặp tiếp
      queue.push(child);
    });
  }

  return queue;
}

// Tiếp theo, chúng ta sẽ viết 1 hàm đóng gói cái graph ở trên để trình duyệt có thể thực thi được
//
// File cuối cùng sẽ chỉ gồm 1 hàm self-invoking (hàm tự gọi, tự chạy) như này:
//
// (function() {})()
//
// Tham số truyền vào duy nhất là cái graph thu được ở trên
function bundle(graph) {
  let modules = '';

  // Để tạo ra phần body cho hàm này, bản chất là lập qua tất cả module
  // Hãy tưởng tượng rằng ta có một chuỗi rỗng ban đầu: var s = '';
  // Sau đó cứ mỗi module, chúng ta sẽ append vào chuỗi đó 1 đoạn: `key: value,`
  // trong đó key là id của module và value là mã của nó.
  graph.forEach(mod => {
    // Mỗi một module sẽ tạo ra một cặp `key: value,`
    // trong đó value là một mảng gồm 2 giá trị
    //
    // Giá trị thứ nhất là code của module, được bao trong một hàm nhằm mục đích
    // tránh xung đột cho các biến trong module đó với module khác
    //
    // Our modules, after we transpiled them, use the CommonJS module system:
    // They expect a `require`, a `module` and an `exports` objects to be
    // available. Those are not normally available in the browser so we'll
    // implement them and inject them into our function wrappers.
    //
    // Giá trị thứ 2 là một mapping có dạng: {'đường dẫn' : 'ID'}
    // { './relative/path': 1 }.
    //
    // Điều này giúp ta biết được code tương ứng với relative path dễ dàng hơn mà thôi
    // Chẳng hạn khi relative path = './relative/path' thì ta biết module ID = 1,
    // nó là 1 field của chính Object này rồi nên có thể lấy ngay code được
    modules += `${mod.id}: [
      function (require, module, exports) {
        ${mod.code}
      },
      ${JSON.stringify(mod.mapping)},
    ],`;
  });

  const result = `
    (function(modules) {
      function require(id) {
        const [fn, mapping] = modules[id];
        function localRequire(name) {
          return require(mapping[name]);
        }
        const module = { exports : {} };
        fn(localRequire, module, module.exports);
        return module.exports;
      }
      require(0);
    })({${modules}})
  `;

  return result;
}

const graph = createGraph('./example/entry.js');
const result = bundle(graph);

console.log(result);
