
require('dotenv').config()

const express = require('express')
const cors = require('cors')
const runAgent = require('./testingAgent')

const app = express()

app.use(cors())
app.use(express.json())

app.get('/api/health',(req,res)=>{
  res.json({status:'Backend Running'})
})

app.post('/api/start-test', async(req,res)=>{

  try {

    const report = await runAgent(
      req.body.appUrl,
      req.body.username,
      req.body.password
    )

    res.json({
      success:true,
      report
    })

  } catch(error) {

    console.log(error)

    res.status(500).json({
      error:error.message
    })
  }
})

app.listen(5000,()=>{
  console.log('Backend running on http://localhost:5000')
})
