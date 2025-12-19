const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const SharedNote = require('../models/SharedNote');

const router = express.Router();

router.use(protect);
router.use(restrictTo('agent'));

/**
 * @desc    Get all knowledge notes (with search and filtering)
 * @route   GET /api/knowledge
 */
router.get('/', async (req, res) => {
  try {
    const { search, category, tag } = req.query;
    const query = {};

    if (category) {
      query.category = category;
    }
    if (tag) {
      query.tags = tag;
    }
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }

    const notes = await SharedNote.find(query)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      notes
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Get single note by ID
 * @route   GET /api/knowledge/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const note = await SharedNote.findById(req.params.id)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name');

    if (!note) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    res.status(200).json({
      success: true,
      note
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Create a new shared note
 * @route   POST /api/knowledge
 */
router.post('/', async (req, res) => {
  try {
    const { title, content, category, tags } = req.body;

    if (!title || !content || !category) {
      return res.status(400).json({ success: false, message: 'Missing title, content, or category' });
    }

    const note = await SharedNote.create({
      title,
      content,
      category,
      tags: tags || [],
      createdBy: req.user._id
    });

    const populated = await note.populate('createdBy', 'name');

    res.status(251).json({
      success: true,
      note: populated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Update a shared note
 * @route   PUT /api/knowledge/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { title, content, category, tags } = req.body;
    const note = await SharedNote.findById(req.params.id);

    if (!note) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    note.title = title || note.title;
    note.content = content || note.content;
    note.category = category || note.category;
    note.tags = tags || note.tags;
    note.updatedBy = req.user._id;

    await note.save();
    const populated = await note.populate('createdBy updatedBy', 'name');

    res.status(200).json({
      success: true,
      note: populated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @desc    Delete a shared note
 * @route   DELETE /api/knowledge/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const note = await SharedNote.findById(req.params.id);

    if (!note) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    await SharedNote.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Article deleted successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
