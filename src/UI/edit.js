import PDFJSAnnotate from '../PDFJSAnnotate';
import appendChild from '../render/appendChild';
import {
  addEventListener,
  removeEventListener
} from './event';
import {
  BORDER_COLOR,
  disableUserSelect,
  enableUserSelect,
  findSVGContainer,
  findSVGAtPoint,
  getScroll,
  getMetadata,
  getRectangleSize,
  getDrawingSize,getOffset,
  scaleDown
} from './utils';

let _enabled = false;
let isDragging = false, overlay;
let dragOffsetX, dragOffsetY, dragStartX, dragStartY;
const OVERLAY_BORDER_SIZE = 3;

function createEditOverlay(target) {
  destroyEditOverlay();

  overlay = document.createElement('div');
  let id = target.getAttribute('data-pdf-annotate-id');
  let type = target.getAttribute('data-pdf-annotate-type');
  let size = type === 'drawing' ? getDrawingSize(target) : getRectangleSize(target);
  let { offsetLeft, offsetTop } = getOffset(target);
  let styleLeft = size.x + offsetLeft - OVERLAY_BORDER_SIZE;
  let styleTop = size.y + offsetTop - OVERLAY_BORDER_SIZE;
  
  overlay.setAttribute('id', 'pdf-annotate-edit-overlay');
  overlay.setAttribute('data-target-id', id);
  overlay.style.boxSizing = 'content-box';
  overlay.style.position = 'absolute';
  overlay.style.top = `${styleTop}px`;
  overlay.style.left = `${styleLeft}px`;
  overlay.style.width = `${size.w}px`;
  overlay.style.height = `${size.h}px`;
  overlay.style.border = `${OVERLAY_BORDER_SIZE}px solid ${BORDER_COLOR}`;
  overlay.style.borderRadius = `${OVERLAY_BORDER_SIZE}px`;
  
  document.body.appendChild(overlay);
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keyup', handleDocumentKeyup);
  document.addEventListener('mousedown', handleDocumentMousedown);
}

function destroyEditOverlay() {
  if (!overlay) { return; }

  overlay.parentNode.removeChild(overlay);
  overlay = null;

  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keyup', handleDocumentKeyup);
  document.removeEventListener('mousedown', handleDocumentMousedown);
}

function handleDocumentClick(e) {
  if (!findSVGAtPoint(e.clientX, e.clientY)) { return; }

  // Remove current overlay
  let overlay = document.getElementById('pdf-annotate-edit-overlay');
  if (overlay) {
    if (isDragging || e.target === overlay) {
      return;
    }

    destroyEditOverlay();
  }
}

function handleDocumentKeyup(e) {
  if (overlay && e.keyCode === 46 &&
      e.target.nodeName.toLowerCase() !== 'textarea' &&
      e.target.nodeName.toLowerCase() !== 'input') {
    let annotationId = overlay.getAttribute('data-target-id');
    let nodes = document.querySelectorAll(`[data-pdf-annotate-id="${annotationId}"]`);
    let svg = findSVGAtPoint(parseInt(overlay.style.left, 10), parseInt(overlay.style.top, 10));
    let { documentId } = getMetadata(svg);

    Array.prototype.forEach.call(nodes, (n) => {
      n.parentNode.removeChild(n);
    });
    
    PDFJSAnnotate.StoreAdapter.deleteAnnotation(documentId, annotationId);

    destroyEditOverlay();
  }
}

function handleDocumentMousedown(e) {
  if (e.target !== overlay) { return; }

  isDragging = true;
  dragOffsetX = e.clientX;
  dragOffsetY = e.clientY;
  dragStartX = overlay.offsetLeft;
  dragStartY = overlay.offsetTop;

  overlay.style.background = 'rgba(255, 255, 255, 0.7)';
  overlay.style.cursor = 'move';

  document.addEventListener('mousemove', handleDocumentMousemove);
  document.addEventListener('mouseup', handleDocumentMouseup);
  disableUserSelect();
}

function handleDocumentMousemove(e) {
  let annotationId = overlay.getAttribute('data-target-id');
  let parentNode = document.querySelector(`[data-pdf-annotate-id="${annotationId}"]`).parentNode;
  let rect = parentNode.getBoundingClientRect();
  let y = (dragStartY + (e.clientY - dragOffsetY));
  let x = (dragStartX + (e.clientX - dragOffsetX));
  let minY = rect.top;
  let maxY = rect.bottom;
  let minX = rect.left;
  let maxX = rect.right;

  if (y > minY && y + overlay.offsetHeight < maxY) {
    overlay.style.top = `${y}px`;
  }

  if (x > minX && x + overlay.offsetWidth < maxX) {
    overlay.style.left = `${x}px`;
  }
}

function handleDocumentMouseup(e) {
  let annotationId = overlay.getAttribute('data-target-id');
  let target = document.querySelectorAll(`[data-pdf-annotate-id="${annotationId}"]`);
  let type = target[0].getAttribute('data-pdf-annotate-type');
  let svg = findSVGContainer(target[0]);
  let { offsetTop, offsetLeft } = getOffset(target[0]);
  let { scrollTop, scrollLeft } = getScroll(target[0]);
  let { documentId } = getMetadata(svg);

  function getDelta(propX, propY) {
    return calcDelta(parseInt(target[0].getAttribute(propX), 10), parseInt(target[0].getAttribute(propY), 10));
  }

  function calcDelta(x, y) {
    return {
      deltaX: OVERLAY_BORDER_SIZE + scrollLeft + scaleDown(svg, {x: overlay.offsetLeft - offsetLeft}).x - x,
      deltaY: OVERLAY_BORDER_SIZE + scrollTop + scaleDown(svg, {y: overlay.offsetTop - offsetTop}).y - y
    };
  }

  PDFJSAnnotate.StoreAdapter.getAnnotation(documentId, annotationId).then((annotation) => {
    if (['area', 'highlight', 'point', 'textbox'].indexOf(type) > -1) {
      let { deltaX, deltaY } = getDelta('x', 'y');
      Array.prototype.forEach.call(target, (t, i) => {
        if (deltaY !== 0) {
          let y = parseInt(t.getAttribute('y'), 10) + deltaY;

          if (type === 'textbox') {
            y += parseInt(overlay.style.height, 10);
          }

          t.setAttribute('y', y);
          if (annotation.rectangles) {
            annotation.rectangles[i].y = y;
          } else if (annotation.y) {
            annotation.y = y;
          }
        }
        if (deltaX !== 0) {
          let x = parseInt(t.getAttribute('x'), 10) + deltaX;

          t.setAttribute('x', x);
          if (annotation.rectangles) {
            annotation.rectangles[i].x = x;
          } else if (annotation.x) {
            annotation.x = x;
          }
        }
      });
    } else if (type === 'strikeout') {
      let { deltaX, deltaY } = getDelta('x1', 'y1');
      Array.prototype.forEach.call(target, (t, i) => {
        if (deltaY !== 0) {
          t.setAttribute('y1', parseInt(t.getAttribute('y1'), 10) + deltaY);
          t.setAttribute('y2', parseInt(t.getAttribute('y2'), 10) + deltaY);
          annotation.rectangles[i].y = parseInt(t.getAttribute('y1'), 10);
        }
        if (deltaX !== 0) {
          t.setAttribute('x1', parseInt(t.getAttribute('x1'), 10) + deltaX);
          t.setAttribute('x2', parseInt(t.getAttribute('x2'), 10) + deltaX);
          annotation.rectangles[i].x = parseInt(t.getAttribute('x1'), 10);
        }
      });
    } else if (type === 'drawing') {
      let size = scaleDown(svg, getDrawingSize(target[0]));
      let [originX, originY] = annotation.lines[0];
      let { deltaX, deltaY } = calcDelta(originX, originY);

      // origin isn't necessarily at 0/0 in relation to overlay x/y
      // adjust the difference between overlay and drawing coords
      deltaY += (originY - size.y);
      deltaX += (originX - size.x);

      annotation.lines.forEach((line, i) => {
        let [x, y] = annotation.lines[i];
        annotation.lines[i][0] = x + deltaX;
        annotation.lines[i][1] = y + deltaY;
      });

      target[0].parentNode.removeChild(target[0]);
      appendChild(svg, annotation);
    }

    PDFJSAnnotate.StoreAdapter.editAnnotation(documentId, annotationId, annotation);
  });

  setTimeout(() => {
    isDragging = false;
  }, 0);

  overlay.style.background = '';
  overlay.style.cursor = '';

  document.removeEventListener('mousemove', handleDocumentMousemove);
  document.removeEventListener('mouseup', handleDocumentMouseup);
  enableUserSelect();
}

function handleAnnotationClick(target) {
  createEditOverlay(target);
}

export function enableEdit () {
  if (_enabled) { return; }

  _enabled = true;
  addEventListener('annotation:click', handleAnnotationClick);
};

export function disableEdit () {
  if (!_enabled) { return; }

  _enabled = false;
  removeEventListener('annotation:click', handleAnnotationClick);
};

