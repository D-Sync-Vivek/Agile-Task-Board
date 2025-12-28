"use client"
import { Column } from "@/types"
import { useKanbanStore } from "@/store/useKanbanStore"
const ColumnContainer = ({column}: {column: Column}) => {

  const deleteColumn = useKanbanStore((state) => state.deleteColumn)
  const tasks = useKanbanStore((state) => state.tasks)
  
  function callDeleteColumn(){
    const id = column.id
    deleteColumn(id)
  }
  return (
    <div className="bg-gray-100 w-87.5 p-3">
      <span>{column.title}</span>
      {tasks.filter(task => task.columnId === column.id).map((task) => (
        <p key={task.columnId}>{task.content}</p>
      ))}
      <span onClick={callDeleteColumn}>🗑️</span>
    </div>
  )
}

export default ColumnContainer
